const RiverSim = require('../sim.js');
const assert = require('assert');

function run(Q, v, years) {
  const sim = new RiverSim({ Q, v });
  sim.setPath(RiverSim.presetPath(sim.worldW, sim.worldH, sim.oceanH));
  const s0 = sim.sinuosity(), w0 = sim.width;
  const p0 = { x: sim.pts[0].x, y: sim.pts[0].y };
  assert(sim.pts[0].y < sim.pts.at(-1).y, 'flow top→bottom');
  let firstCut = null;
  let maxX = -1e9, minX = 1e9;
  for (let y = 0; y < years; y += 1) {
    sim.advance(1);
    if (firstCut === null && sim.cutoffs > 0) firstCut = sim.year;
    for (const p of sim.pts) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN');
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    }
    assert(sim.pts.length < 800, 'node explosion ' + sim.pts.length);
  }
  assert(sim.width > w0 * 1.05, 'width should grow');
  assert(sim.deltaAdvance > 30, 'delta should grow: ' + sim.deltaAdvance);
  // 上游彈簧：可輕微漂移，但唔好離太遠
  assert(Math.hypot(sim.pts[0].x - p0.x, sim.pts[0].y - p0.y) < 80, 'source spring');
  // 河口應進入／接近海洋帶（三角洲）
  assert(sim.pts.at(-1).y > sim.baseCoastY - 30, 'mouth near/into sea');
  console.log(`Q=${Q} v=${v}: sin ${s0.toFixed(2)}→${sim.sinuosity().toFixed(2)}, w ${w0.toFixed(0)}→${sim.width.toFixed(0)}, delta=${sim.deltaAdvance.toFixed(0)}m, cutoffs=${sim.cutoffs}, ox=${sim.oxbows.length}, firstCut=${firstCut && firstCut.toFixed(0)}, x=[${minX.toFixed(0)},${maxX.toFixed(0)}]`);
  return { sim, firstCut };
}

const a = run(600, 1.2, 1200);
assert(a.sim.cutoffs >= 1, 'expected some cutoffs');
assert(a.sim.cutoffs <= 12, 'too many cutoffs (spam)');
run(150, 0.5, 1200);
run(1200, 2.0, 1200);

// self-intersect
const sim = new RiverSim();
sim.setPath([
  { x: 1100, y: 200 }, { x: 1100, y: 1200 }, { x: 900, y: 1400 },
  { x: 700, y: 1200 }, { x: 900, y: 1000 }, { x: 1050, y: 1250 },
  { x: 1100, y: 2400 }
]);
console.log('self-intersect cutoffs:', sim.cutoffs);
assert(sim.cutoffs >= 1);

const rev = new RiverSim();
rev.setPath([{ x: 1100, y: 2400 }, { x: 1200, y: 1500 }, { x: 1000, y: 500 }, { x: 1100, y: 200 }]);
assert(rev.pts[0].y < rev.pts.at(-1).y);
console.log('ALL OK');
