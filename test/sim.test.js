const RiverSim = require('../sim.js');
const assert = require('assert');

function assertNoSeaClimb(sim, label) {
  assert.strictEqual(sim.countOceanPoints(5), 0, label + ': ocean pts=' + sim.countOceanPoints(5));
  assert.strictEqual(sim.hasSeaUTurn(), false, label + ': sea U-turn');
  const m = sim.pts[sim.pts.length - 1];
  assert(m.y <= sim.waterLineY(m.x) + 0.5, label + ': mouth past waterline y=' + m.y + ' wl=' + sim.waterLineY(m.x));
  // Along-path: after first near-coast contact, cumulative y progress is seaward (no inland climb after sea touch)
  assertMonotonicTowardMouth(sim, label);
}

function assertMonotonicTowardMouth(sim, label) {
  const p = sim.pts;
  if (p.length < 4) return;
  let touch = -1;
  for (let i = 0; i < p.length; i++) {
    if (p[i].y >= sim.waterLineY(p[i].x) - 40) { touch = i; break; }
  }
  if (touch < 0) return;
  // After touch, no point climbs inland by >80m relative to the touch / running max
  let floorY = p[touch].y;
  for (let i = touch + 1; i < p.length; i++) {
    assert(p[i].y >= floorY - 80, label + ': post-coast inland climb at i=' + i + ' y=' + p[i].y + ' floor=' + floorY);
    floorY = Math.max(floorY, p[i].y - 15);
  }
  // Mouth is the southernmost extreme of the path (within slack for small meanders)
  const maxY = Math.max(...p.map(q => q.y));
  assert(p[p.length - 1].y >= maxY - 50, label + ': mouth not near max-Y (U-turn past mouth)');
}

function run(Q, v, years) {
  const sim = new RiverSim({ Q, v });
  sim.setPath(RiverSim.presetPath(sim.worldW, sim.worldH, sim.oceanH));
  assert(sim.widthAt(1) > sim.widthAt(0) * 1.2);
  for (let y = 0; y < years; y++) {
    sim.advance(1);
    if (y % 100 === 0) assertNoSeaClimb(sim, 'Q' + Q + '@' + y);
  }
  assertNoSeaClimb(sim, 'Q' + Q + ' final');
  assert(sim.deltaAdvance > 20);
  // No oxbow may intersect ocean
  for (const o of sim.oxbows) {
    assert(sim.oxbowOnLand(o), 'oxbow intersects ocean yr=' + o.year);
    assert(o.pts.every(q => q.y < sim.waterLineY(q.x) - 4), 'oxbow point in sea');
  }
  console.log(`Q=${Q}: n=${sim.pts.length} ${sim.upstreamWidth.toFixed(0)}→${sim.mouthWidth.toFixed(0)} delta=${sim.deltaAdvance.toFixed(0)} cuts=${sim.cutoffs} ox=${sim.oxbows.length}`);
}

run(600, 1.2, 1500);
run(400, 1.0, 1200);
run(900, 1.5, 1200);

// Enters sea then would return inland — truncate must drop the return
const bad = new RiverSim();
bad.setPath([
  { x: 1100, y: 200 }, { x: 1100, y: 2000 }, { x: 1100, y: 2700 },
  { x: 800, y: 2800 }, { x: 800, y: 1800 }, { x: 900, y: 2200 }
]);
assertNoSeaClimb(bad, 'artificial');
assert(bad.pts.at(-1).y > bad.baseCoastY - 40, 'mouth near coast');
let hit = -1, hitY = 0;
for (let i = 0; i < bad.pts.length; i++) {
  if (bad.pts[i].y >= bad.waterLineY(bad.pts[i].x) - 40) { hit = i; hitY = bad.pts[i].y; break; }
}
assert(hit >= 0, 'should reach coast');
for (let i = hit + 1; i < bad.pts.length; i++) {
  assert(bad.pts[i].y >= hitY - 80, 'post-coast inland climb at ' + i);
}
assert(Math.min(...bad.pts.slice(-5).map(p => p.y)) > 2000, 'tail must stay near coast, not y=1800');
// Mid-channel sea then land again: still truncate at first sea hit
const mid = new RiverSim();
mid.setPath([
  { x: 1000, y: 100 }, { x: 1000, y: 1500 },
  { x: 1000, y: 2600 }, // near coast
  { x: 1000, y: 2900 }, // INTO ocean
  { x: 1200, y: 2000 }, // back on land — MUST be dropped
  { x: 1200, y: 2500 }
]);
assert.strictEqual(mid.countOceanPoints(5), 0, 'mid-sea return: ocean pts');
assert.strictEqual(mid.hasSeaUTurn(), false, 'mid-sea return: u-turn');
assert(mid.pts.every(q => q.y < 2850), 'no deep-ocean / return inland points kept');
assert(Math.min(...mid.pts.map(p => p.y)) < 500, 'still has upstream');
console.log('artificial OK n=' + bad.pts.length + ' mouth=' + (bad.pts.at(-1).y | 0));
console.log('mid-sea OK n=' + mid.pts.length + ' mouth=' + (mid.pts.at(-1).y | 0));
console.log('ALL OK');
