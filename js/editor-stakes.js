// Editor -> Stakes (MU-1): every number of the Stakes game in one place, a switch for whether managers see the tab, and a wallet reset.
// All of it is one row in stakes_settings (supabase/migrations/0063_stakes_settings.sql); the game's database functions read it, so a change applies straight away.
// A pick keeps the payout it was placed at, so changing the multiplier only affects new picks.
//   stakesView() -> the tab's shell;  mountStakes({ db, esc, explain }) -> fills it in
export const stakesView = () => '<h1>Stakes</h1><div id="sk-root"><p class="quiet">Loading…</p></div>';

export const STAT_NAMES = { sv: 'Saves (goalkeepers)', pas: 'Passes (midfielders)', sot: 'Shots on target (forwards)', tk: 'Tackles won (defenders)' };
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// What the form says (a FormData), as the object the database takes. Anything that cannot be a number is left out so the database keeps its old value.
export function readSettings(f) {
  const n = k => (f.get(k) === null || f.get(k) === '' ? undefined : Number(f.get(k)));
  const out = {
    start_coins: n('start_coins'), daily_topup: n('daily_topup'), bailout_below: n('bailout_below'), bailout_to: n('bailout_to'),
    multiplier: n('multiplier'), min_stake: n('min_stake'), max_stake: n('max_stake') ?? 0,
    lines_per_week: n('lines_per_week'), lines_per_match: n('lines_per_match'), score_per_week: n('score_per_week'), score_exact_mult: n('score_exact_mult'), score_result_mult: n('score_result_mult'), line_adjust: n('line_adjust'), lock_minutes: n('lock_minutes'), lines_days: n('lines_days'),
    show_board: f.get('show_board') === 'on', stats: f.getAll('stats'),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined || (typeof out[k] === 'number' && !Number.isFinite(out[k]))) delete out[k];
  return out;
}

export async function mountStakes({ db, esc, explain }) {
  const root = document.getElementById('sk-root');
  if (!root) return;
  const c = await db();
  let S = null, sum = null, msg = '', bad = false, confirmReset = false;

  const load = async () => {
    const [a, b] = await Promise.all([c.from('stakes_settings').select('*').eq('id', 1).maybeSingle(), c.rpc('stakes_summary')]);
    if (a.error || !a.data) { msg = a.error ? explain(a.error) : 'Stakes settings are missing. Run the database update 0063_stakes_settings.sql once.'; bad = true; S = null; } else S = a.data;
    sum = b.data?.[0] || null;
  };
  const say = (text, isBad = false) => { msg = text; bad = isBad; };
  const save = async patch => {
    const { error } = await c.rpc('stakes_save_settings', { p: patch });
    if (error) say(explain(error), true); else say('Saved. It applies straight away.');
    await load(); draw();
  };

  const bar = (key, title, on, yes, no) => `<section class="dr-vis ${on ? 'on' : 'off'}"><div><h2>${title}</h2><p>${on ? yes : no}</p></div>
    <div class="dr-switch" role="group" aria-label="${title}"><button type="button" data-flip="${key}" data-v="0" aria-pressed="${!on}">NO</button><button type="button" data-flip="${key}" data-v="1" aria-pressed="${on}">YES</button></div></section>`;
  const field = (label, name, value, o = {}) => `<label>${label}${o.hint ? ` <i>${o.hint}</i>` : ''}<input name="${name}" type="number" min="${o.min ?? 0}" max="${o.max ?? 1000000}" step="${o.step ?? 1}" value="${esc(value)}"></label>`;

  function draw() {
    if (!S) { root.innerHTML = `<p class="${bad ? 'err' : 'quiet'}">${esc(msg || 'Stakes settings did not load.')}</p>`; return; }
    const stat = k => `<label class="dr-check"><input type="checkbox" name="stats" value="${k}"${S.stats.includes(k) ? ' checked' : ''}> ${esc(STAT_NAMES[k])}</label>`;
    root.innerHTML = `${bar('visible', 'MAKE PAGE VISIBLE', S.visible, 'YES: managers can see the Stakes tab. You always see it yourself.', 'NO: managers can’t see the Stakes tab yet. Switch it on when you’re ready.')}
      ${bar('betting_open', 'BETTING OPEN', S.betting_open, 'YES: managers can pick and new lines are made.', 'NO: managers can still look but can’t pick, and no new lines are made. Picks already made still settle.')}
      ${sum ? `<p class="ed-hint">${sum.wallets} wallet${sum.wallets === 1 ? '' : 's'} holding ${Number(sum.coins).toLocaleString('en-AU')} Coins · ${sum.open_picks} pick${sum.open_picks === 1 ? '' : 's'} riding · ${sum.settled_picks} settled · ${sum.lines} line${sum.lines === 1 ? '' : 's'} made</p>` : ''}
      ${msg ? `<p class="${bad ? 'err' : 'ed-hint'}" role="status">${esc(msg)}</p>` : ''}
      <form class="sk-form" novalidate>
        <section class="ed-invite"><h2>Coins</h2>
          <div class="ed-fields">${field('Starting Coins', 'start_coins', S.start_coins, { hint: 'for a new wallet' })}${field('Daily top-up', 'daily_topup', S.daily_topup, { hint: 'once a day, 0 = none' })}</div>
          <div class="ed-fields">${field('Bail-out when under', 'bailout_below', S.bailout_below, { hint: 'and nothing riding' })}${field('Bail-out tops up to', 'bailout_to', S.bailout_to, { hint: '0 = no bail-out' })}</div></section>
        <section class="ed-invite"><h2>Payout and stakes</h2>
          <div class="ed-fields">${field('Payout multiplier', 'multiplier', S.multiplier, { min: 1.01, max: 10, step: 0.01, hint: '1.90 = 100 wins 190 back' })}${field('Smallest stake', 'min_stake', S.min_stake, { min: 1 })}${field('Biggest stake', 'max_stake', S.max_stake, { hint: '0 = no limit' })}</div></section>
        <section class="ed-invite"><h2>Stakes</h2>
          <div class="ed-fields">${field('Stakes per round', 'lines_per_week', S.lines_per_week, { min: 1, max: 24, hint: 'the most valuable starters across the round' })}${field('Most from one match', 'lines_per_match', S.lines_per_match, { min: 1, max: 6, hint: 'spreads them across the round' })}${field('Harder or easier lines (%)', 'line_adjust', S.line_adjust, { min: -30, max: 30, hint: '+ raises every line, − lowers it' })}</div>
          <div class="ed-fields">${field('Picks close before kick-off (minutes)', 'lock_minutes', S.lock_minutes, { max: 1440, hint: '0 = at kick-off' })}${field('Lines open this many days ahead', 'lines_days', S.lines_days, { min: 1, max: 28 })}</div>
          <p class="ed-hint">Which stats are offered (a player only gets a stake when his stat is ticked):</p>
          <div class="sk-stats">${['sv', 'pas', 'sot', 'tk'].map(stat).join('')}</div>
          <p class="ed-hint">Each stake is a card with the player’s photo; the line is set near his average and always ends in .5, so there is a winner. Stakes already made keep their number.</p></section>
        <section class="ed-invite"><h2>Guess the score</h2>
          <div class="ed-fields">${field('Score predictions per round', 'score_per_week', S.score_per_week, { min: 0, max: 24, hint: 'part of the stakes per round, matches picked at random, 0 = none' })}${field('Exact score pays', 'score_exact_mult', S.score_exact_mult, { min: 1.01, max: 100, step: 0.5, hint: 'times the stake' })}${field('Right result pays', 'score_result_mult', S.score_result_mult, { min: 1.01, max: 10, step: 0.25, hint: 'home win, draw or away win, wrong score; below the exact payout' })}</div></section>
        <section class="ed-invite"><h2>Leaderboard</h2>
          <label class="dr-check"><input type="checkbox" name="show_board"${S.show_board ? ' checked' : ''}> Show the leaderboard to managers</label></section>
        <div class="ed-actions"><button class="btn" type="submit">Save settings</button></div>
      </form>
      <section class="ed-invite sk-danger"><h2>Reset wallets</h2>
        <p class="ed-hint">Puts every wallet back to the amount below and takes back picks that haven’t settled. Settled results stay in each manager’s history.</p>
        <form class="sk-reset ed-fields" novalidate>${field('Reset every wallet to', 'reset_to', S.start_coins)}
          <div class="ed-actions">${confirmReset ? '<button class="btn" type="submit" data-do="reset">Yes, reset every wallet</button> <button class="btn ghost" type="button" data-do="cancel">Cancel</button>' : '<button class="btn" type="button" data-do="ask">Reset wallets…</button>'}</div></form></section>`;
  }

  root.addEventListener('click', async e => {
    const flip = e.target.closest('[data-flip]');
    if (flip) { await save({ [flip.dataset.flip]: flip.dataset.v === '1' }); return; }
    const d = e.target.closest('[data-do]')?.dataset.do;
    if (d === 'ask') { confirmReset = true; draw(); }
    if (d === 'cancel') { confirmReset = false; draw(); }
  });
  root.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.matches('.sk-form')) {
      const patch = readSettings(new FormData(e.target));
      if (!patch.stats?.length) { say('Tick at least one stat to offer.', true); draw(); return; }
      if (patch.max_stake && patch.min_stake && patch.max_stake < patch.min_stake) { say('The biggest stake can’t be smaller than the smallest.', true); draw(); return; }
      await save(patch);
    } else if (e.target.matches('.sk-reset')) {
      const to = num(new FormData(e.target).get('reset_to'), -1);
      if (to < 0) { say('Pick an amount from 0 to 1,000,000.', true); confirmReset = false; draw(); return; }
      const { data, error } = await c.rpc('stakes_reset', { p_coins: to });
      confirmReset = false;
      if (error) say(explain(error), true); else say(`Reset ${data} wallet${data === 1 ? '' : 's'} to ${to.toLocaleString('en-AU')} Coins.`);
      await load(); draw();
    }
  });
  await load(); draw();
}
