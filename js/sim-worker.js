// Runs the HCL match engine (Python, in js/sim/hcl_sim; see js/sim/README.md)
// in the browser with Pyodide. Used only by js/simulate.js, which starts this worker on demand.

importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');

const ENGINE_FILES = ['__init__', 'config', 'geometry', 'physics', 'models', 'ratings', 'tactics',
  'decisions', 'engine', 'output', 'validate', 'teams', 'run'];

const BRIDGE = `
import sys, json
sys.path.insert(0, '/home/pyodide')
import js
from hcl_sim.run import simulate, match_seed
from hcl_sim.validate import validate

def run_fixture(job, league_json, home, away, seed, info_json):
    league = json.loads(league_json)
    info = json.loads(info_json)
    if seed is None:
        seed = match_seed(info.get('fixture_id') or f"{home}-{away}")
    def progress(f):
        js.reportProgress(job, f)
    data = simulate(league, home, away, seed=int(seed), info=info, on_progress=progress)
    rep = validate(data)
    if not rep['ok']:
        raise RuntimeError('The simulated match failed its consistency check: ' + '; '.join(f'{k}: {d}' for k, d in rep['problems'][:3]))
    return json.dumps(data, separators=(',', ':'))
`;

self.reportProgress = (job, p) => postMessage({ type: 'progress', job, p });

let py;
const ready = (async () => {
  py = await loadPyodide();
  py.FS.mkdirTree('/home/pyodide/hcl_sim');
  await Promise.all(ENGINE_FILES.map(async f => {
    const res = await fetch(`sim/hcl_sim/${f}.py`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Couldn't load engine file ${f}.py`);
    py.FS.writeFile(`/home/pyodide/hcl_sim/${f}.py`, await res.text());
  }));
  py.runPython(BRIDGE);
  postMessage({ type: 'ready' });
})();
ready.catch(err => postMessage({ type: 'failed', message: String(err && err.message || err) }));

const lastLine = err => String(err && err.message || err).trim().split('\n').pop();

onmessage = async e => {
  const m = e.data;
  try {
    await ready;
    const out = py.globals.get('run_fixture')(m.job, m.league, m.home, m.away, m.seed ?? null, JSON.stringify(m.info || {}));
    postMessage({ type: 'result', job: m.job, payload: out });
  } catch (err) {
    postMessage({ type: 'error', job: m.job, message: lastLine(err) });
  }
};
