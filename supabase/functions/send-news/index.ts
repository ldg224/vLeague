// vLeague 0.19.0: email a news post to the managers in its audience. Only the league office can call it (POST { id } or
// { id, test: true } to send just to yourself, with your own session). A post goes out once: the email_log row for
// (manager, 'news', post id) is written first, so a double click or a retry never sends twice. Managers who turned
// "League news" off in Settings are skipped. Sent from the vLeague Gmail account over SMTP (port 465).
// Secrets (set in Supabase, never in this repo): SMTP_USER, SMTP_PASS, UNSUB_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SITE = 'https://ldg224.github.io/vLeague/';
const ORIGINS = ['https://ldg224.github.io', 'http://localhost:8767'];
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

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const colourOf = (c: unknown) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : '#1e88e5');
const httpsOf = (u: unknown) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');

async function sign(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('UNSUB_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const unsubscribeUrl = async (user: string) =>
  `${env('SUPABASE_URL')}/functions/v1/email-unsubscribe?u=${user}&k=news&t=${await sign(`${user}:news`)}`;

// The post's message as email HTML: the same small markdown as the site (bold, italic, underline, links, lists, headings).
const inline = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>')
  .replace(/__(.+?)__/g, '<u>$1</u>')
  .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#90caf9">$1</a>');
function markdown(text: string, vars: Record<string, string>) {
  const t = String(text ?? '').replace(/\{(team|manager)\}/g, (_, k) => vars[k] || (k === 'team' ? 'your club' : 'manager'));
  const p = 'margin:0 0 12px;font-size:15px;line-height:1.55;color:#d6dde8';
  return esc(t).split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(x => {
    if (/^#{1,3} /.test(x)) return `<h2 style="margin:18px 0 8px;font-size:17px;color:#ffffff">${inline(x.replace(/^#{1,3} /, ''))}</h2>`;
    if (/^[-*] /m.test(x)) return `<ul style="margin:0 0 12px;padding-left:20px;${p.replace('margin:0 0 12px;', '')}">${x.split('\n').map(l => `<li>${inline(l.replace(/^[-*] /, ''))}</li>`).join('')}</ul>`;
    return `<p style="${p}">${inline(x).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}
const plain = (html: string) => html.replace(/<\/(p|li|h2)>/g, '\n').replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

type Post = { id: number; title: string; body: string | null; data: Record<string, any> | null };

function compose(post: Post, vars: Record<string, string>, unsub: string) {
  const d = post.data || {}, accent = colourOf(d.colour);
  const image = d.image ? `${env('SUPABASE_URL')}/storage/v1/object/public/news/${encodeURI(String(d.image))}` : '';
  const url = httpsOf(d.button?.url), label = String(d.button?.label || '').trim();
  const body = markdown(post.body || '', vars);
  const html = `<!doctype html><html><body style="margin:0;background:#0a0f19;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#ffffff">
  <div style="max-width:560px;margin:0 auto;padding:28px 22px">
    <p style="margin:0 0 18px;font:700 18px Arial Narrow,Arial,sans-serif;letter-spacing:.5px">v<b>LEAGUE</b> <span style="font-weight:400;color:#808b9c;font-size:13px;letter-spacing:0">League news</span></p>
    <div style="background:#121a2a;border-radius:14px;overflow:hidden;border-top:4px solid ${accent}">
      ${image ? `<img src="${esc(image)}" alt="" width="560" style="display:block;width:100%;height:auto;border:0">` : ''}
      <div style="padding:22px 22px 10px">
        <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#ffffff">${esc(post.title)}</h1>
        ${body}
        ${url && label ? `<p style="margin:20px 0 12px"><a href="${esc(url)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:${accent};color:#ffffff;font-weight:700;text-decoration:none">${esc(label)}</a></p>` : ''}
      </div>
    </div>
    <p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#808b9c"><a href="${SITE}inbox.html" style="color:#90caf9">Open your Inbox</a> ·
      <a href="${esc(unsub)}" style="color:#90caf9">Turn league news emails off</a> · <a href="${SITE}settings.html" style="color:#90caf9">Email settings</a></p>
  </div></body></html>`;
  const text = [post.title, '', plain(body), ...(url && label ? ['', `${label}: ${url}`] : []), '', `Turn league news emails off: ${unsub}`].join('\n');
  return { html, text };
}

Deno.serve(async req => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return reply({ error: 'Which post?' }, 400);

  // Only the league office.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(jwt);
  if (!who?.user) return reply({ error: 'Sign in first.' }, 401);
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle();
  if (me?.role !== 'office') return reply({ error: 'Only the league office can send news.' }, 403);

  const { data: post } = await admin.from('news').select('id, title, body, data, emailed_at').eq('id', id).eq('kind', 'post').maybeSingle();
  if (!post) return reply({ error: 'That post is gone.' }, 404);

  const client = new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: env('SMTP_USER'), password: env('SMTP_PASS') } },
  });
  const send = async (to: string, vars: Record<string, string>, user: string) => {
    const unsub = await unsubscribeUrl(user);
    const { html, text } = compose(post as Post, vars, unsub);
    await client.send({
      from: `vLeague <${env('SMTP_USER')}>`, to, subject: post.title, content: text, html,
      headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  };

  try {
    // A test goes to the caller only, and changes nothing.
    if (body.test) {
      await send(who.user.email!, { team: 'Your club', manager: 'manager' }, who.user.id);
      return reply({ ok: true, to: who.user.email });
    }
    if (post.emailed_at) return reply({ error: 'This post has already been emailed.' }, 409);

    const { data: people, error } = await admin.rpc('news_recipients', { p_id: id });
    if (error) return reply({ error: 'Couldn’t work out who to email.' }, 500);
    const clubs = new Map((await admin.from('clubs').select('code, name')).data?.map((c: any) => [c.code, c.name]) || []);
    if (!people?.length) return reply({ ok: true, sent: 0, failed: 0 });
    let sent = 0;
    const failed: string[] = [];
    for (const r of (people || []) as { user_id: string; email: string; name: string; club: string }[]) {
      // Log first: a double click only gets the row once.
      const { error: taken } = await admin.from('email_log').insert({ user_id: r.user_id, kind: 'news', key: String(id) });
      if (taken) continue;
      try {
        await send(r.email, { team: String(clubs.get(r.club) || 'your club'), manager: r.name || 'manager' }, r.user_id);
        sent++;
      } catch (e) {
        await admin.from('email_log').delete().eq('user_id', r.user_id).eq('kind', 'news').eq('key', String(id));
        failed.push(String(e).slice(0, 100));
      }
    }
    if (sent) await admin.from('news').update({ emailed_at: new Date().toISOString(), emailed_count: sent }).eq('id', id);
    return reply({ ok: true, sent, failed: failed.length });
  } catch (e) {
    return reply({ error: 'The email didn’t send. Try again later.', detail: String(e).slice(0, 200) }, 502);
  } finally { await client.close(); }
});
