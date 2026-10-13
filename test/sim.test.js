const RiverSim = require('../sim.js');
const assert = require('assert');

function assertNoSeaClimb(sim, label) {
  assert.strictEqual(sim.countOceanPoints(5), 0, label + ': ocean pts=' + sim.countOceanPoints(5));
  assert.strictEqual(sim.hasSeaUTurn(), false, label + ': sea U-turn');
  const m = sim.pts[sim.pts.length - 1];
  assert(m.y <= sim.waterLineY(m.x) + 0.5, label + ': mouth past waterline');
}

function assertSimpleChannel(sim, label) {
  const nX = sim.countSelfIntersections();
  assert.strictEqual(nX, 0, label + ': self-intersections=' + nX);
  const mouth = sim.pts[sim.pts.length - 1];
  assert(mouth.y <= sim.waterLineY(mouth.x) + 0.5, label + ': mouth past waterline');
  assert(mouth.y >= sim.baseCoastY - 80, label + ': mouth too far inland');
  // 「第二河口」：除末段外，唔應再有點貼到水線 ≤4m（真正入海）
  let foreign = 0;
  const n = sim.pts.length;
  for (let i = 0; i < n - 3; i++) {
    const p = sim.pts[i];
    if (p.y >= sim.waterLineY(p.x) - 4) foreign++;
  }
  assert.strictEqual(foreign, 0, label + ': extra waterline contacts=' + foreign);
}

function run(Q, v, years) {
  const sim = new RiverSim({ Q, v });
  sim.setPath(RiverSim.presetPath(sim.worldW, sim.worldH, sim.oceanH));
  assertSimpleChannel(sim, 'Q' + Q + ' init');
  assert(sim.widthAt(1) > sim.widthAt(0) * 1.2);
  for (let y = 0; y < years; y++) {
    sim.advance(1);
    if (y % 100 === 0) {
      assertNoSeaClimb(sim, 'Q' + Q + '@' + y);
      assertSimpleChannel(sim, 'Q' + Q + '@' + y);
    }
  }
  assertNoSeaClimb(sim, 'Q' + Q + ' final');
  assertSimpleChannel(sim, 'Q' + Q + ' final');
  assert(sim.deltaAdvance > 20);
  const sin = sim.sinuosity();
  // Prefer open meanders; allow brief higher after growth but not spaghetti
  assert(sin < 2.6, 'Q' + Q + ' sinuosity too high: ' + sin);
  console.log(`Q=${Q}: n=${sim.pts.length} sin=${sin.toFixed(2)} ${sim.upstreamWidth.toFixed(0)}→${sim.mouthWidth.toFixed(0)} delta=${sim.deltaAdvance.toFixed(0)} cuts=${sim.cutoffs} ox=${sim.oxbows.length}`);
}

run(600, 1.2, 1500);
run(400, 1.0, 1200);
run(900, 1.5, 1200);

// Artificial crossing must be resolved
const cross = new RiverSim();
cross.setPath([
  { x: 900, y: 200 },
  { x: 900, y: 800 },
  { x: 1400, y: 1200 },
  { x: 600, y: 1600 },
  { x: 1400, y: 2000 }, // crosses previous limbs potentially after resample
  { x: 900, y: 2400 }
]);
// Force a clear figure-8 by splicing
cross.pts = [
  { x: 1000, y: 300 },
  { x: 1000, y: 900 },
  { x: 1400, y: 1100 },
  { x: 700, y: 1400 },
  { x: 1400, y: 1700 },
  { x: 700, y: 1100 }, // crosses
  { x: 1000, y: 2000 },
  { x: 1000, y: 2500 }
];
cross.computeGeom();
const before = RiverSim.findSelfIntersections(cross.pts).length;
assert(before >= 1, 'fixture should self-intersect, got ' + before);
cross.resolveSelfIntersections(10);
assert.strictEqual(cross.countSelfIntersections(), 0, 'after resolve still intersects');
assertSimpleChannel(cross, 'crossed-fixture');
console.log('crossing fixture OK cuts=' + cross.cutoffs);

// Sea then inland still truncates
const bad = new RiverSim();
bad.setPath([
  { x: 1100, y: 200 }, { x: 1100, y: 2000 }, { x: 1100, y: 2700 },
  { x: 800, y: 2800 }, { x: 800, y: 1800 }, { x: 900, y: 2200 }
]);
assertNoSeaClimb(bad, 'artificial-sea');
assertSimpleChannel(bad, 'artificial-sea');
console.log('ALL OK');
