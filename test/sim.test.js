const RiverSim = require('../sim.js');
const assert = require('assert');
function run(Q, v, years) {
  const sim = new RiverSim({ Q, v });
  sim.setPath(RiverSim.presetPath(sim.worldW, sim.worldH));
  const s0 = sim.sinuosity(), p0 = sim.pts.map(p => ({...p}));
  let firstCut = null;
  for (let y = 0; y < years; y += 1) {
    sim.advance(1);
    if (firstCut === null && sim.cutoffs > 0) firstCut = sim.year;
    for (const p of sim.pts) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN at year ' + sim.year);
    assert(sim.pts.length < 3000, 'node explosion');
  }
  console.log(`Q=${Q} v=${v}: nodes=${sim.pts.length} sinuosity ${s0.toFixed(2)} -> ${sim.sinuosity().toFixed(2)}, cutoffs=${sim.cutoffs}, firstCut=${firstCut && firstCut.toFixed(0)}yr, meanRate=${sim.meanRate.toFixed(1)}m/yr, oxbows=${sim.oxbows.length}, endpoints fixed=${sim.pts[0].x===p0[0].x && sim.pts.at(-1).x===p0.at(-1).x}`);
  return { sim, s0, firstCut };
}
const a = run(600, 1.2, 1500);
assert(a.sim.cutoffs > 0, 'expected cutoffs');
run(150, 0.5, 1500);
run(3000, 3.0, 1500);
// drawn self-intersecting path triggers immediate cutoff
const sim = new RiverSim();
const loop = [{x:200,y:900},{x:1200,y:900},{x:1400,y:700},{x:1200,y:500},{x:1000,y:700},{x:1150,y:960},{x:2800,y:900}];
sim.setPath(loop);
console.log('self-intersect cutoffs:', sim.cutoffs);
assert(sim.cutoffs >= 1);
console.log('ALL OK');
