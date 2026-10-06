// vLeague 0.7.0: email reminders. pg_cron calls this every 5 minutes (header x-cron-secret); it sends whatever
// public.due_emails() says is due, logging each one first so nothing is ever sent twice. A signed-in user can also
// POST { test: true } (with their own session) to get a test email. Sent from the vLeague Gmail account over SMTP
// (port 465; Supabase blocks 587). Every email has a one-click unsubscribe for its kind (email-unsubscribe).
// Secrets (set in Supabase, never in this repo): SMTP_USER, SMTP_PASS, CRON_SECRET, UNSUB_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SITE = 'https://ldg224.github.io/vLeague/';
const ORIGINS = ['https://ldg224.github.io', 'http://localhost:8767'];
const TZ = 'Australia/Melbourne';
const env = (k: string) => Deno.env.get(k) || '';

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// ---------------------------------------------------------------- helpers

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', {
  timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}).replace(/\s+/g, ' ');
const shortWhen = (iso: string) => new Date(iso).toLocaleString('en-AU', {
  timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit',
}).replace(/\s+/g, ' ');

async function sign(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('UNSUB_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unsubscribeUrl(user: string, kind: string) {
  return `${env('SUPABASE_URL')}/functions/v1/email-unsubscribe?u=${user}&k=${kind}&t=${await sign(`${user}:${kind}`)}`;
}

// An email: a heading, a few lines (HTML, already escaped), one button.
type Mail = { subject: string; heading: string; lines: string[]; button?: [string, string] };

function layout(o: Mail, unsub?: string) {
  const foot = unsub
    ? `<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#808b9c">You get this because of your vLeague settings.
        <a href="${esc(unsub)}" style="color:#90caf9">Turn these off</a> · <a href="${SITE}settings.html" style="color:#90caf9">Email settings</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#0a0f19;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#ffffff">
  <div style="max-width:520px;margin:0 auto;padding:28px 22px">
    <p style="margin:0 0 22px;font:700 18px Arial Narrow,Arial,sans-serif;letter-spacing:.5px">v<b>LEAGUE</b></p>
    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${esc(o.heading)}</h1>
    ${o.lines.map(l => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#d6dde8">${l}</p>`).join('')}
    ${o.button ? `<p style="margin:22px 0"><a href="${esc(o.button[1])}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#1e88e5;color:#ffffff;font-weight:700;text-decoration:none">${esc(o.button[0])}</a></p>` : ''}
    ${foot}
  </div></body></html>`;
  const plain = (l: string) => l.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const lines = [o.heading, '', ...o.lines.map(plain)];
  if (o.button) lines.push('', `${o.button[0]}: ${o.button[1]}`);
  if (unsub) lines.push('', `Turn these off: ${unsub}`);
  return { html, text: lines.join('\n') };
}

type Row = { user_id: string; email: string; name: string; kind: string; key: string; data: Record<string, any> };
type Season = { teams: any[]; players: any[]; fixtures: any[] };

const teamName = (s: Season | null, code: string) => s?.teams.find(t => t.code === code)?.name || code;
const fixtureOf = (s: Season | null, club: string, week: number) =>
  s?.fixtures.find(f => f.week === week && (f.home === club || f.away === club)) || null;
const kickoff = (f: any) => new Date(f.starts_at);

// The league as the emails need it, read from the database (clubs, players, fixtures with their results). A result
// counts as played once its match has kicked off, the same rule the site uses.
async function loadSeason(admin: any): Promise<Season | null> {
  const [clubs, players, fixtures, results] = await Promise.all([
    admin.from('clubs').select('code, name'),
    admin.from('players').select('id, name'),
    admin.from('fixtures').select('id, week, home, away, starts_at, postponed').range(0, 1999),
    admin.from('results').select('fixture, summary').range(0, 1999),
  ]);
  if (clubs.error || players.error || fixtures.error || results.error) return null;
  const summary = new Map((results.data as any[]).map(r => [r.fixture, r.summary]));
  return {
    teams: clubs.data,
    players: players.data,
    fixtures: (fixtures.data as any[]).map(f => ({ ...f, result: f.postponed ? null : summary.get(f.id) || null })),
  };
}

// ---------------------------------------------------------------- each kind of email

async function compose(r: Row, s: Season | null, admin: any): Promise<Mail | null> {
  const first = esc(r.name.split(' ')[0]);
  const d = r.data;
  if (r.kind === 'deadline') {
    const fx = fixtureOf(s, d.club, d.week);
    const vs = fx ? `${teamName(s, fx.home)} v ${teamName(s, fx.away)}` : `week ${d.week}`;
    return {
      subject: `Pick your XI: week ${d.week} locks ${shortWhen(d.locks_at)}`,
      heading: `Pick your XI for week ${d.week}`,
      lines: [`Hi ${first}, you haven’t picked a team for <b>${esc(vs)}</b> yet.`,
        `Line-ups lock <b>${esc(when(d.locks_at))}</b>. If you don’t pick one, the engine picks for you.`],
      button: ['Pick your XI', `${SITE}club.html`],
    };
  }
  if (r.kind === 'sent_back') {
    return {
      subject: 'Your club changes were sent back',
      heading: 'Your club changes were sent back',
      lines: [`Hi ${first}, the league office would like a change before approving them.`, ...(d.note ? [`“${esc(d.note)}”`] : [])],
      button: ['Fix and resend', `${SITE}setup.html?edit`],
    };
  }
  if (r.kind === 'lineups_out') {
    const fx = fixtureOf(s, d.club, d.week);
    if (!fx) return null;
    const opp = fx.home === d.club ? fx.away : fx.home;
    const { data: sheet } = await admin.from('week_sheets').select('*').eq('week', d.week).eq('club', opp).maybeSingle();
    const names = new Map((s?.players || []).map((p: any) => [String(p.id), p.name]));
    const xi = sheet && Object.keys(sheet.lineup || {}).length
      ? `<b>${esc(sheet.formation || '')}</b>: ${Object.values(sheet.lineup).map(id => esc(names.get(String(id)) || '?')).join(', ')}`
      : 'No team sheet. The engine picks their team.';
    return {
      subject: `Week ${d.week} line-ups are out`,
      heading: `${teamName(s, opp)}’s line-up`,
      lines: [`Week ${d.week}: ${esc(teamName(s, fx.home))} v ${esc(teamName(s, fx.away))}.`, xi],
      button: ['See both teams', `${SITE}home.html`],
    };
  }
  if (r.kind === 'weekly') {
    const since = Date.now() - 7 * 864e5;
    const done = (s?.fixtures || []).filter(f => f.result && f.starts_at && kickoff(f).getTime() > since && kickoff(f).getTime() < Date.now() - 2 * 3600e3);
    if (!done.length) return null;
    return {
      subject: 'Your vLeague week',
      heading: 'This week in vLeague',
      lines: done.map(f => `${esc(teamName(s, f.home))} <b>${f.result.home}–${f.result.away}</b> ${esc(teamName(s, f.away))}`),
      button: ['Table and results', `${SITE}league.html`],
    };
  }
  if (r.kind === 'office_digest') {
    const clubs: string[] = d.clubs || [];
    return {
      subject: `${clubs.length} club${clubs.length === 1 ? '' : 's'} without a team for week ${d.week}`,
      heading: `Week ${d.week} locks ${shortWhen(d.locks_at)}`,
      lines: [`These clubs haven’t picked a team yet: ${clubs.map(esc).join(', ')}.`],
      button: ['Open the Editor', `${SITE}editor.html#deadlines`],
    };
  }
  return null;
}

// ---------------------------------------------------------------- sending

function mailer() {
  return new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: env('SMTP_USER'), password: env('SMTP_PASS') } },
  });
}

async function send(client: SMTPClient, to: string, mail: Mail, unsub?: string) {
  const { html, text } = layout(mail, unsub);
  await client.send({
    from: `vLeague <${env('SMTP_USER')}>`,
    to,
    subject: mail.subject,
    content: text,
    html,
    headers: unsub ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {},
  });
}

Deno.serve(async req => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  // A test email for the signed-in caller (at most one a minute).
  if (body.test) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user?.email) return reply({ error: 'Sign in first.' }, 401);
    const minute = new Date().toISOString().slice(0, 16);
    const { error: dupe } = await admin.from('email_log').insert({ user_id: who.user.id, kind: 'test', key: minute });
    if (dupe) return reply({ error: 'One test email a minute. Try again shortly.' }, 429);
    const client = mailer();
    try {
      await send(client, who.user.email, {
        subject: 'vLeague test email', heading: 'Emails are working',
        lines: ['This is how vLeague reminders will look.'], button: ['Email settings', `${SITE}settings.html`],
      });
      return reply({ ok: true, to: who.user.email });
    } catch (e) {
      await admin.from('email_log').delete().eq('user_id', who.user.id).eq('kind', 'test').eq('key', minute);
      return reply({ error: 'The email didn’t send. Try again later.', detail: String(e).slice(0, 200) }, 502);
    } finally { await client.close(); }
  }

  // The scheduled run.
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return reply({ error: 'Not allowed.' }, 403);
  const { data: due, error } = await admin.rpc('due_emails');
  if (error) return reply({ error: error.message }, 500);
  if (!due?.length) return reply({ ok: true, sent: 0 });
  const season = await loadSeason(admin);
  const client = mailer();
  let sent = 0;
  const failed: string[] = [];
  try {
    for (const r of due as Row[]) {
      // Log first: if two runs overlap, only one gets the row.
      const { error: taken } = await admin.from('email_log').insert({ user_id: r.user_id, kind: r.kind, key: r.key });
      if (taken) continue;
      try {
        const mail = await compose(r, season, admin);
        if (!mail) continue;   // nothing worth sending (e.g. no results this week): stays logged, so not retried
        await send(client, r.email, mail, await unsubscribeUrl(r.user_id, r.kind));
        sent++;
      } catch (e) {
        await admin.from('email_log').delete().eq('user_id', r.user_id).eq('kind', r.kind).eq('key', r.key);
        failed.push(`${r.kind}: ${String(e).slice(0, 120)}`);
      }
    }
  } finally { await client.close(); }
  return reply({ ok: true, sent, failed });
});
