const RiverSim = require('../sim.js');
const assert = require('assert');

function run(Q, v, years) {
  const sim = new RiverSim({ Q, v });
  sim.setPath(RiverSim.presetPath(sim.worldW, sim.worldH, sim.oceanH));
  const s0 = sim.sinuosity(), w0 = sim.width;
  const p0 = { x: sim.pts[0].x, y: sim.pts[0].y };
  const pN = { x: sim.pts.at(-1).x, y: sim.pts.at(-1).y };
  // 上游在上、河口在下
  assert(sim.pts[0].y < sim.pts.at(-1).y, 'flow should be top→bottom');
  assert(sim.pts.at(-1).y < sim.landH, 'mouth on land above ocean');
  let firstCut = null;
  for (let y = 0; y < years; y += 1) {
    sim.advance(1);
    if (firstCut === null && sim.cutoffs > 0) firstCut = sim.year;
    for (const p of sim.pts) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN at year ' + sim.year);
    assert(sim.pts.length < 3000, 'node explosion');
    assert(sim.width <= sim.baseWidth * 2.61 + 1e-6, 'width ceiling broken');
  }
  assert(sim.width > w0 * 1.05, 'width should grow with erosion: ' + w0 + ' -> ' + sim.width);
  assert(sim.pts[0].x === p0.x && sim.pts[0].y === p0.y, 'upstream fixed');
  assert(sim.pts.at(-1).x === pN.x && sim.pts.at(-1).y === pN.y, 'mouth fixed');
  console.log(`Q=${Q} v=${v}: nodes=${sim.pts.length} sin ${s0.toFixed(2)}→${sim.sinuosity().toFixed(2)}, w ${w0.toFixed(0)}→${sim.width.toFixed(0)} (${sim.widenRatio.toFixed(2)}×), cutoffs=${sim.cutoffs}, firstCut=${firstCut && firstCut.toFixed(0)}yr`);
  return { sim, firstCut };
}

const a = run(600, 1.2, 1500);
assert(a.sim.cutoffs > 0, 'expected cutoffs');
run(150, 0.5, 1500);
run(2000, 2.5, 1500);

// self-intersecting vertical path
const sim = new RiverSim();
const loop = [
  { x: 1100, y: 200 }, { x: 1100, y: 1200 }, { x: 900, y: 1400 },
  { x: 700, y: 1200 }, { x: 900, y: 1000 }, { x: 1050, y: 1250 },
  { x: 1100, y: 2500 }
];
sim.setPath(loop);
console.log('self-intersect cutoffs:', sim.cutoffs, 'orientation ok:', sim.pts[0].y < sim.pts.at(-1).y);
assert(sim.cutoffs >= 1);

// reverse-drawn path auto-flips
const rev = new RiverSim();
rev.setPath([{ x: 1100, y: 2500 }, { x: 1200, y: 1500 }, { x: 1000, y: 500 }, { x: 1100, y: 200 }]);
assert(rev.pts[0].y < rev.pts.at(-1).y, 'auto reverse to top→bottom');
console.log('ALL OK');
