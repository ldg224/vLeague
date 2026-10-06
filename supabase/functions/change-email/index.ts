// vLeague 0.16.0: the Editor's pen next to a manager's email. Only the league office may call it. It changes the
// address an account signs in with (no confirmation email: the office has checked it) using the service role key,
// which is why it runs here and never in the website. Deploy: docs/BACKEND.md.
//
// POST { id, email }  ->  { ok: true }  or  { error: "readable message" }
import { createClient } from 'npm:@supabase/supabase-js@2';

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

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Who is calling? Must be the league office.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply({ error: 'Sign in again.' }, 401);
  const { data: me } = await admin.from('profiles').select('role').eq('id', caller.user.id).maybeSingle();
  if (me?.role !== 'office') return reply({ error: 'Only the league office can change an email.' }, 403);

  let body: { id?: string; email?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Bad request.' }, 400); }
  const id = String(body.id || '');
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: 'Pick an account.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: 'That email doesn’t look right.' }, 400);

  const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
  if (error) {
    const m = error.message || '';
    if (/already.*(registered|exists|been)/i.test(m)) return reply({ error: 'Another account already uses that email.' }, 409);
    return reply({ error: 'The email didn’t change. Try again.' }, 500);
  }
  return reply({ ok: true });
});
