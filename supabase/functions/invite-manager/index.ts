// vLeague 0.4.0: the Editor's "Invite a manager". Only the league office may call it. It emails an invite from
// vLeague (the link goes to set-password.html) and links the new account to its club. It needs the service role
// key, which is why it runs here and never in the website. Deploy: docs/BACKEND.md.
//
// POST { email, club, name? }  ->  { ok: true, id }  or  { error: "readable message" }
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://ldg224.github.io/vLeague/';
const ORIGINS = ['https://ldg224.github.io', 'http://localhost:8767'];

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async req => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Who is calling? Must be the league office.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply({ error: 'Sign in again.' }, 401);
  const { data: me } = await admin.from('profiles').select('role').eq('id', caller.user.id).maybeSingle();
  if (me?.role !== 'office') return reply({ error: 'Only the league office can invite managers.' }, 403);

  let body: { email?: string; club?: string; name?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Bad request.' }, 400); }
  const email = String(body.email || '').trim().toLowerCase();
  const club = String(body.club || '').trim().toUpperCase();
  const name = String(body.name || '').trim().slice(0, 40) || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: 'That email doesn’t look right.' }, 400);

  const { data: row } = await admin.from('clubs').select('code').eq('code', club).maybeSingle();
  if (!row) return reply({ error: 'Pick a club.' }, 400);
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('club', club).eq('role', 'manager');
  if (count) return reply({ error: 'That club already has a manager account. Unlink it first.' }, 409);

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE}set-password.html`,
    data: name ? { name } : undefined,
  });
  if (error) {
    const m = error.message || '';
    if (/already.*(registered|exists)/i.test(m)) return reply({ error: 'That email already has an account. Link it from the list instead.' }, 409);
    if (/rate limit/i.test(m)) return reply({ error: 'Too many emails sent this hour. Try again later.' }, 429);
    return reply({ error: m || 'The invite didn’t send.' }, 500);
  }

  // The new-user trigger has made the profile; link it to the club.
  const { error: linkError } = await admin.from('profiles').update({ club, display_name: name }).eq('id', data.user.id);
  if (linkError) return reply({ error: 'The invite was sent, but linking the club failed. Link it from the list.' }, 500);
  return reply({ ok: true, id: data.user.id });
});
