const RiverSim = require('../sim.js');
const assert = require('assert');

function assertNoSeaClimb(sim, label) {
  assert.strictEqual(sim.countOceanPoints(5), 0, label + ': ocean pts=' + sim.countOceanPoints(5));
  assert.strictEqual(sim.hasSeaUTurn(), false, label + ': sea U-turn');
  const m = sim.pts[sim.pts.length - 1];
  assert(m.y <= sim.waterLineY(m.x) + 0.5, label + ': mouth past waterline');
}

function assertSimpleChannel(sim, label) {
  assert.strictEqual(sim.countSelfIntersections(), 0, label + ': self-xings');
  const mouth = sim.pts[sim.pts.length - 1];
  assert(mouth.y <= sim.waterLineY(mouth.x) + 0.5, label + ': mouth past wl');
  assert(mouth.y >= sim.baseCoastY - 80, label + ': mouth inland');
  let foreign = 0;
  for (let i = 0; i < sim.pts.length - 3; i++) {
    if (sim.pts[i].y >= sim.waterLineY(sim.pts[i].x) - 4) foreign++;
  }
  assert.strictEqual(foreign, 0, label + ': extra mouths=' + foreign);
}

function assertCentered(sim, label) {
  const st = sim.channelXStats();
  assert(st.fracLeft10 < 0.12, label + ': glued left frac=' + st.fracLeft10.toFixed(3));
  assert(st.fracRight10 < 0.12, label + ': glued right frac=' + st.fracRight10.toFixed(3));
  assert(st.mean > sim.worldW * 0.22 && st.mean < sim.worldW * 0.78,
    label + ': meanX=' + st.mean.toFixed(0) + ' not mid-map');
}

function run(Q, v, years) {
  const sim = new RiverSim({ Q, v });
  sim.setPath(RiverSim.presetPath(sim.worldW, sim.worldH, sim.oceanH));
  assertSimpleChannel(sim, 'Q' + Q + ' init');
  assertCentered(sim, 'Q' + Q + ' init');
  assert(sim.widthAt(1) > sim.widthAt(0) * 1.15);
  const sins = [];
  for (let y = 0; y < years; y++) {
    sim.advance(1);
    if (y % 100 === 0) {
      assertNoSeaClimb(sim, 'Q' + Q + '@' + y);
      assertSimpleChannel(sim, 'Q' + Q + '@' + y);
    }
    if (y >= 500 && y % 50 === 0) {
      assertCentered(sim, 'Q' + Q + '@' + y);
      sins.push(sim.sinuosity());
    }
  }
  assertNoSeaClimb(sim, 'Q' + Q + ' final');
  assertSimpleChannel(sim, 'Q' + Q + ' final');
  assertCentered(sim, 'Q' + Q + ' final');
  assert(sim.deltaAdvance > 20);
  const sin = sim.sinuosity();
  assert(sin < 2.15, 'Q' + Q + ' sin too high: ' + sin);
  // Over late samples, often in teaching band 1.25–2.0
  if (sins.length) {
    const inBand = sins.filter(s => s >= 1.22 && s <= 2.05).length;
    assert(inBand / sins.length >= 0.45, 'Q' + Q + ' sin rarely in band: ' + sins.map(s => s.toFixed(2)).join(','));
  }
  console.log(`Q=${Q}: n=${sim.pts.length} sin=${sin.toFixed(2)} meanX=${sim.channelXStats().mean.toFixed(0)} ${sim.upstreamWidth.toFixed(0)}→${sim.mouthWidth.toFixed(0)} delta=${sim.deltaAdvance.toFixed(0)} cuts=${sim.cutoffs} ox=${sim.oxbows.length}`);
}

run(600, 1.2, 1200);
run(400, 1.0, 900);
run(900, 1.5, 900);

const cross = new RiverSim();
cross.pts = [
  { x: 1000, y: 300 }, { x: 1000, y: 900 }, { x: 1400, y: 1100 },
  { x: 700, y: 1400 }, { x: 1400, y: 1700 }, { x: 700, y: 1100 },
  { x: 1000, y: 2000 }, { x: 1000, y: 2500 }
];
cross.computeGeom();
assert(RiverSim.findSelfIntersections(cross.pts).length >= 1);
cross.resolveSelfIntersections(10);
assert.strictEqual(cross.countSelfIntersections(), 0);
console.log('crossing OK');

const bad = new RiverSim();
bad.setPath([
  { x: 1100, y: 200 }, { x: 1100, y: 2000 }, { x: 1100, y: 2700 },
  { x: 800, y: 2800 }, { x: 800, y: 1800 }, { x: 900, y: 2200 }
]);
assertNoSeaClimb(bad, 'sea');
assertSimpleChannel(bad, 'sea');

// Preset starts centered with open meanders
const pre = new RiverSim();
pre.setPath(RiverSim.presetPath(pre.worldW, pre.worldH, pre.oceanH));
assertCentered(pre, 'preset');
assert(pre.sinuosity() >= 1.12 && pre.sinuosity() <= 1.9, 'preset sin=' + pre.sinuosity());
console.log('preset sin=' + pre.sinuosity().toFixed(2) + ' meanX=' + pre.channelXStats().mean.toFixed(0));
console.log('ALL OK');
