// V2-5: whether this device gets the 3D match picture (v2/match3d-core.js) or today's 2D broadcast. Nothing here loads three.js; the player only
// imports the 3D once this says yes.
//
// 2D when: no WebGL 2; the manager chose Lite mode "On" in Settings (Automatic lite, which every phone has, still gets 3D: the 3D has its own
// low level for phones); under 2 GB of memory or fewer than 4 processor cores; or the 3D was too slow or lost its picture on this device
// within the last week (remembered here, so it isn't tried again on every match). ?3d=0 or ?3d=1 in the address forces either, for testing.
const KEY = 'vleague-3d';
const WEEK = 7 * 24 * 3600 * 1000;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private window: not kept */ } };

let webgl2 = null;
function hasWebGL2() {
  if (webgl2 != null) return webgl2;
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });   // a software-only renderer counts as none
    webgl2 = !!gl; gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl2 = false; }
  return webgl2;
}

// { ok, why }: why is a short reason for testing (shown nowhere on the page).
export function support3d(search = location.search) {
  const force = new URLSearchParams(search).get('3d');
  if (force === '0') return { ok: false, why: 'forced off' };
  if (force === '1') return { ok: hasWebGL2(), why: hasWebGL2() ? 'forced on' : 'no WebGL 2' };
  let lite = 'auto';
  try { lite = JSON.parse(localStorage.getItem('vleague-device') || '{}')?.lite || 'auto'; } catch { /* default */ }
  if (lite === 'on') return { ok: false, why: 'lite mode on' };
  if ((navigator.deviceMemory ?? 8) < 2 || (navigator.hardwareConcurrency ?? 8) < 4) return { ok: false, why: 'weak device' };
  const slow = read().slowAt;
  if (slow && Date.now() - slow < WEEK) return { ok: false, why: 'too slow here last time' };
  if (!hasWebGL2()) return { ok: false, why: 'no WebGL 2' };
  return { ok: true, why: '' };
}

// The 3D couldn't keep up (or lost its picture): 2D on this device for a week.
export function mark3dSlow(why = '') { write({ ...read(), slowAt: Date.now(), why }); }
