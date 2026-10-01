// vLeague 0.7.0: the "Turn these off" link in every reminder email, and one-click unsubscribe from mail apps
// (List-Unsubscribe-Post). GET shows a short page; POST just answers. The link is signed with UNSUB_SECRET, so
// nobody can switch off someone else's emails. It switches off that one kind of email in the user's settings.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://ldg224.github.io/vLeague/';
const KINDS: Record<string, string> = {
  deadline: 'deadline reminders', sent_back: 'emails when club changes are sent back',
  lineups_out: 'line-ups out emails', weekly: 'the weekly round-up', office_digest: 'clubs-without-a-team emails',
};

async function sign(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('UNSUB_SECRET') || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const page = (title: string, text: string, status = 200) => new Response(`<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | vLeague</title></head>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0f19;color:#fff;font-family:Segoe UI,Helvetica,Arial,sans-serif">
  <main style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
  <p style="color:#b0bac9;line-height:1.5;margin:0 0 20px">${text}</p>
  <a href="${SITE}settings.html" style="color:#90caf9;font-weight:700">Email settings</a></main></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

Deno.serve(async req => {
  const url = new URL(req.url);
  const user = url.searchParams.get('u') || '', kind = url.searchParams.get('k') || '', token = url.searchParams.get('t') || '';
  const ok = KINDS[kind] && /^[0-9a-f-]{36}$/.test(user) && token && token === await sign(`${user}:${kind}`);
  if (!ok) return req.method === 'POST' ? new Response('bad link', { status: 400 }) : page('Link not recognised', 'Change your emails in Settings instead.', 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: row } = await admin.from('user_settings').select('prefs').eq('user_id', user).maybeSingle();
  const prefs = row?.prefs || {};
  prefs.email = { ...(prefs.email || {}), [kind]: kind === 'deadline' ? 'off' : false };
  const { error } = await admin.from('user_settings').upsert({ user_id: user, prefs });
  if (error) return req.method === 'POST' ? new Response('error', { status: 500 }) : page('That didn’t work', 'Try again, or change it in Settings.', 500);
  return req.method === 'POST' ? new Response('ok') : page('Done', `You won’t get ${KINDS[kind]} any more.`);
});
