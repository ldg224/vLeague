// vLeague 0.46.0: the footer's "Suggest changes". Only a signed-in manager (or the office) may call it. It saves the
// message in `suggestions`, gives it a reference (B-nn for an issue, S-nn for a suggestion; 0.46.1) and makes a card on the
// league's Trello board, in the INBOX list, titled "B-06: ...". An issue gets the Bug label, a suggestion the Suggestion
// label, and both get "Form Response". The office then moves the card on from the INBOX. The Trello key and token are
// Edge Function secrets (TRELLO_KEY, TRELLO_TOKEN); they never reach the website or this repo. Deploy: docs/BACKEND.md.
//
// POST { kind: 'issue' | 'suggestion', title, details? }  ->  { ok: true, code: 'B-06' }  or  { error: "readable message" }
import { createClient } from 'npm:@supabase/supabase-js@2';

const ORIGINS = ['https://ldg224.github.io', 'http://localhost:8767'];
const PER_HOUR = 5;

// The vLeague Work board (https://trello.com/b/RuJSt4r3/vleague-work): the INBOX list and the label ids.
const INBOX = '6ac891395ce2898b916118a6';
const LABELS = {
  issue: ['6ac882f2ef2524934da04d03', '6ac897adcad7c64e3c5f00f1'],        // Bug + Form Response
  suggestion: ['6ac88dc90140371bdd9bda8a', '6ac897adcad7c64e3c5f00f1'],   // Suggestion + Form Response
};

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

  // Who is calling? A manager or the office, never a guest.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply({ error: 'Sign in again.' }, 401);
  const { data: me } = await admin.from('profiles').select('role, club, display_name').eq('id', caller.user.id).maybeSingle();
  if (!me || !['manager', 'office'].includes(me.role)) return reply({ error: 'Only managers can send suggestions.' }, 403);

  let body: { kind?: string; title?: string; details?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Bad request.' }, 400); }
  const kind = body.kind === 'issue' ? 'issue' : body.kind === 'suggestion' ? 'suggestion' : null;
  const title = String(body.title || '').replace(/\s+/g, ' ').trim();
  const details = String(body.details || '').trim().slice(0, 1500);
  if (!kind) return reply({ error: 'Choose Issue or Suggestion.' }, 400);
  if (title.length < 3) return reply({ error: 'Give it a short title.' }, 400);
  if (title.length > 80) return reply({ error: 'Keep the title under 80 characters.' }, 400);

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('suggestions').select('id', { count: 'exact', head: true }).eq('user_id', caller.user.id).gte('created_at', since);
  if ((count ?? 0) >= PER_HOUR) return reply({ error: 'That’s a lot in an hour. Try again a bit later.' }, 429);

  const { data: code, error: codeError } = await admin.rpc('next_suggestion_code', { p_kind: kind });
  if (codeError || !code) return reply({ error: 'It didn’t save. Try again.' }, 500);
  const { data: row, error: saveError } = await admin.from('suggestions')
    .insert({ user_id: caller.user.id, club: me.club, kind, title, details: details || null, code }).select('id').single();
  if (saveError || !row) return reply({ error: 'It didn’t save. Try again.' }, 500);

  const key = Deno.env.get('TRELLO_KEY'), token = Deno.env.get('TRELLO_TOKEN');
  const who = [me.display_name, me.club].filter(Boolean).join(', ') || 'a manager';
  const desc = `${details || '(no details)'}\n\n---\nSent from the vLeague site by ${who}.`;
  let card: { shortUrl?: string } | null = null;
  if (key && token) {
    const params = new URLSearchParams({ key, token, idList: INBOX, name: `${code}: ${title}`, desc, pos: 'bottom', idLabels: LABELS[kind].join(',') });
    try {
      const r = await fetch('https://api.trello.com/1/cards', { method: 'POST', body: params });
      if (r.ok) card = await r.json();
    } catch { /* recorded below */ }
  }
  await admin.from('suggestions').update({ status: card ? 'sent' : 'failed', card_url: card?.shortUrl ?? null }).eq('id', row.id);
  if (!card) return reply({ error: `It was saved as ${code}, but it didn’t reach the board. Tell the league office.` }, 502);
  return reply({ ok: true, code });
});
