const RiverSim = require('../sim.js');
const assert = require('assert');

function run(Q, v, years) {
  const sim = new RiverSim({ Q, v });
  sim.setPath(RiverSim.presetPath(sim.worldW, sim.worldH, sim.oceanH));
  assert(sim.widthAt(1) > sim.widthAt(0) * 1.2, 'mouth wider than upstream');
  for (let y = 0; y < years; y++) sim.advance(1);
  const land = sim.landChannel();
  const overSea = land.filter(q => q.y > sim.coastY(q.x) + 20).length;
  assert(overSea === 0, 'land channel must not loop over ocean: ' + overSea);
  assert(sim.mouthWidth > sim.upstreamWidth, 'flare');
  assert(sim.deltaAdvance > 20, 'delta grows');
  console.log(`Q=${Q}: up→mouth ${sim.upstreamWidth.toFixed(0)}→${sim.mouthWidth.toFixed(0)}, delta=${sim.deltaAdvance.toFixed(0)}, cuts=${sim.cutoffs}, ox=${sim.oxbows.length}, overSea=${overSea}`);
  return sim;
}
run(600, 1.2, 900);
run(400, 1.0, 900);
console.log('ALL OK');
