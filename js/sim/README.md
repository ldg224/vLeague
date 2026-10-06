# Match engine

`hcl_sim/` is the match engine (physics-based; possession only changes by physical contact). Copied from the s3 test
site in vLeague 0.14. It runs in the browser through `js/sim-worker.js` (Pyodide) and is used by the Editor's Fixtures
tab through `js/simulate.js`, which builds the engine's league input from Supabase (`toLeague`). Public pages never
load it.

## Files

- `hcl_sim/*.py`: the engine. `js/sim-worker.js` loads the files in its `ENGINE_FILES` list; add any new module the
  engine imports there. The site needs `.nojekyll`, or GitHub Pages hides `__init__.py`.
- `tests/test_engine.py`: engine tests, including the no-teleport invariant. Run from this folder after any engine
  change (Python 3.11, stdlib only; takes a few minutes): `python -m unittest discover -s tests`
- `docs/`: `DESIGN.md` (how the engine works), `OUTPUT_FORMAT.md` (match file format), `CALIBRATION.md` (calibration
  results from s3; the calibrate command line stayed in s3).

The s3 command line (`python -m hcl_sim ...`) read s3's `season.json`, so it wasn't copied. Match files are made in the
Editor, not here.
