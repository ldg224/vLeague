// Run with:  node --test "tests/*.test.mjs"
// The browser match engine (js/sim-worker.js) loads only the modules in ENGINE_FILES. 1.50.0 added hcl_sim/rating.py without listing it,
// so every Simulate failed with "No module named 'hcl_sim.rating'" (fixed in 1.50.1). Every engine module must be listed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('sim-worker loads every engine module', () => {
  const src = readFileSync(new URL('../js/sim-worker.js', import.meta.url), 'utf8');
  const listed = new Set([...src.match(/ENGINE_FILES = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
  const modules = readdirSync(new URL('../js/sim/hcl_sim/', import.meta.url)).filter(f => f.endsWith('.py')).map(f => f.slice(0, -3));
  assert.deepEqual(modules.filter(m => !listed.has(m)), [], 'engine modules missing from ENGINE_FILES');
});
