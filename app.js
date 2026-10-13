/* 河曲實驗室 — 介面及繪圖（上＝上游，下＝海洋） */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('map'), ctx = canvas.getContext('2d');
  const sim = new RiverSim({ worldW: 2200, worldH: 3000, oceanH: 480 });
  const WW = sim.worldW, WH = sim.worldH, OH = sim.oceanH, RES = 2;
  const baseCoast = () => sim.baseCoastY;

  const state = {
    running: false, drawMode: false, drawing: null, timeSpeed: 10,
    view: { s: 1, ox: 0, oy: 0, cw: 0, ch: 0, dpr: 1 },
    particles: [], lastHistYear: -99,
    layers: { particles: true, labels: true, history: true },
    lastCutoffs: 0, lastT: performance.now()
  };
  window.__app = { sim, state };

  const terrain = document.createElement('canvas');
  terrain.width = WW / RES; terrain.height = WH / RES;
  const hist = document.createElement('canvas');
  hist.width = WW / RES; hist.height = WH / RES;
  const hctx = hist.getContext('2d');

  function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

  function buildTerrain() {
    const t = terrain.getContext('2d'), r = rng(424242);
    const cell = 100 / RES, cols = Math.ceil(terrain.width / cell) + 1, rows = Math.ceil(terrain.height / cell) + 1;
    const landPx = (WH - OH) / RES;
    const P = [];
    for (let j = 0; j <= rows; j++) {
      P.push([]);
      for (let i = 0; i <= cols; i++) {
        const jx = (i === 0 || i === cols) ? 0 : (r() - 0.5) * cell * 0.65;
        const jy = (j === 0 || j === rows) ? 0 : (r() - 0.5) * cell * 0.65;
        P[j].push([i * cell + jx, j * cell + jy]);
      }
    }
    const tri = (a, b, c) => {
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
      if (cy >= landPx) return; // 海洋另畫
      const yN = cy / landPx; // 0＝高地，1＝近岸
      // 高地：較深綠；近岸：較淺、偏黃的沖積平原
      const h = 95 - yN * 18 + (r() - 0.5) * 10;
      const s = 42 - yN * 18 + (r() - 0.5) * 8;
      const l = 38 + yN * 22 + (r() - 0.5) * 6;
      const col = `hsl(${h},${s}%,${l}%)`;
      t.fillStyle = col; t.strokeStyle = col; t.lineWidth = 1;
      t.beginPath(); t.moveTo(a[0], a[1]); t.lineTo(b[0], b[1]); t.lineTo(c[0], c[1]); t.closePath(); t.fill(); t.stroke();
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i], d = P[j + 1][i + 1];
      if ((i + j) % 2) { tri(a, b, d); tri(a, d, c); } else { tri(a, b, c); tri(b, d, c); }
    }
    // 近岸沙灘／沖積帶
    const beachTop = landPx - 55;
    const g = t.createLinearGradient(0, beachTop, 0, landPx);
    g.addColorStop(0, 'rgba(210,190,140,0)');
    g.addColorStop(0.5, 'rgba(220,200,150,0.45)');
    g.addColorStop(1, 'rgba(210,185,130,0.85)');
    t.fillStyle = g; t.fillRect(0, beachTop, terrain.width, landPx - beachTop + 2);

    // 樹叢：高地較多，近岸較少
    for (let k = 0; k < 220; k++) {
      const y = r() * landPx * 0.92;
      const dens = 1 - y / landPx;
      if (r() > dens * 0.85 + 0.1) continue;
      const x = r() * terrain.width, rad = 5 + r() * 7;
      t.fillStyle = `hsl(${110 + r() * 18},${40 - dens * 10}%,${26 + dens * 8}%)`;
      t.beginPath(); t.moveTo(x, y - rad); t.lineTo(x + rad * 0.9, y + rad * 0.55); t.lineTo(x - rad * 0.9, y + rad * 0.55); t.closePath(); t.fill();
    }

    // 海洋底色（海岸線與三角洲每幀動態畫）
    const sea = t.createLinearGradient(0, landPx, 0, terrain.height);
    sea.addColorStop(0, '#4a9bc8');
    sea.addColorStop(0.4, '#2f7eb0');
    sea.addColorStop(1, '#1e5f90');
    t.fillStyle = sea;
    t.fillRect(0, landPx - 2, terrain.width, terrain.height - landPx + 4);
  }
  buildTerrain();

  function clearHistory() { hctx.clearRect(0, 0, hist.width, hist.height); state.lastHistYear = -99; }
  function stampHistory() {
    const p = sim.landChannel().filter(q => q.y < sim.waterLineY(q.x) - 2);
    if (p.length < 2) return;
    hctx.save(); hctx.scale(1 / RES, 1 / RES);
    hctx.strokeStyle = 'rgba(226,206,150,0.06)';
    hctx.lineWidth = sim.width * 1.0; hctx.lineCap = 'round'; hctx.lineJoin = 'round';
    pathOf(hctx, p); hctx.stroke();
    hctx.restore();
  }
  function stampOxbow(o) {
    const pts = o.pts.filter(q => q.y < sim.waterLineY(q.x) - 4);
    if (pts.length < 4) return;
    hctx.save(); hctx.scale(1 / RES, 1 / RES);
    hctx.strokeStyle = 'rgba(160,150,110,0.4)';
    hctx.lineWidth = o.width * 0.9; hctx.lineCap = 'round'; hctx.lineJoin = 'round';
    pathOf(hctx, pts); hctx.stroke(); hctx.restore();
  }
  function pathOf(c, p) { c.beginPath(); c.moveTo(p[0].x, p[0].y); for (let i = 1; i < p.length; i++) c.lineTo(p[i].x, p[i].y); }

  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    const v = state.view; v.dpr = dpr; v.cw = r.width; v.ch = r.height;
    v.s = Math.min(r.width / WW, r.height / WH);
    v.ox = (r.width - WW * v.s) / 2; v.oy = (r.height - WH * v.s) / 2;
  }
  const toWorld = (cx, cy) => ({ x: (cx - state.view.ox) / state.view.s, y: (cy - state.view.oy) / state.view.s });
  const toScreen = p => ({ x: state.view.ox + p.x * state.view.s, y: state.view.oy + p.y * state.view.s });

  function initParticles() {
    state.particles = [];
    for (let k = 0; k < 280; k++) state.particles.push({ f: Math.random(), o: (Math.random() * 2 - 1) * 0.85, px: null, py: null });
  }
  function locate(s) {
    const g = sim.geom, S = g.s, n = S.length;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const seg = S[hi] - S[lo] || 1, t = Math.min(1, Math.max(0, (s - S[lo]) / seg));
    const a = sim.pts[lo], b = sim.pts[hi];
    return {
      x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
      nx: g.nx[lo] + (g.nx[hi] - g.nx[lo]) * t, ny: g.ny[lo] + (g.ny[hi] - g.ny[lo]) * t,
      cw: g.cw[lo] + (g.cw[hi] - g.cw[lo]) * t
    };
  }
  function updateParticles(dtSec) {
    const g = sim.geom; if (!g || sim.pts.length < 3) return;
    const L = g.length, W = sim.width;
    for (const q of state.particles) {
      const loc = locate(q.f * L);
      let fac = (1 - 1.6 * loc.cw * q.o) * (1 - 0.35 * q.o * q.o);
      fac = Math.max(0.25, Math.min(2.2, fac));
      q.speed = fac;
      q.f += (sim.v * fac * 70 * dtSec) / L;
      if (q.f >= 1) { q.f -= 1; q.o = (Math.random() * 2 - 1) * 0.85; q.px = null; }
      const l2 = locate(q.f * L);
      q.lx = q.px; q.ly = q.py;
      q.px = l2.x + l2.nx * q.o * W * 0.5;
      q.py = l2.y + l2.ny * q.o * W * 0.5;
      // 入海即重生喺上游（唔喺海面畫流動）
      if (q.py > sim.waterLineY(q.px) - 2) { q.f = Math.random() * 0.7; q.px = null; }
    }
  }

  function draw() {
    const v = state.view, c = ctx;
    c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    c.fillStyle = '#5a8a6a'; c.fillRect(0, 0, v.cw, v.ch);
    c.save(); c.translate(v.ox, v.oy); c.scale(v.s, v.s);
    c.drawImage(terrain, 0, 0, WW, WH);
    if (state.layers.history) c.drawImage(hist, 0, 0, WW, WH);

    // 牛軛湖先畫，之後海洋會蓋住任何誤入海區嘅痕跡
    for (const o of sim.oxbows) {
      drawOxbow(c, o);
    }

    // 動態海岸 + 三角洲（蓋過海區上嘅舊痕跡）
    drawCoastAndDelta(c);

    const land = sim.landChannel();
    const g = sim.geom;
    if (land.length >= 2 && g) {
      drawVariableChannel(c, land, g);
      drawBars(c, land, g);
      drawErosion(c, land, g);
      drawDistributaries(c);
      drawMouthPlume(c, land);
    }
    c.restore();

    if (land.length >= 2 && g) {
      if (state.layers.particles) drawParticles(c, land);
      drawEnds(c, land);
      if (state.layers.labels) drawLabels(c, land);
    }
    if (state.drawing && state.drawing.length > 1) {
      c.save(); c.strokeStyle = '#1f5f99'; c.lineWidth = 4; c.setLineDash([10, 7]); c.lineCap = 'round';
      c.beginPath(); state.drawing.forEach((q, i) => { const s = toScreen(q); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.stroke(); c.restore();
    }
    drawOceanLabel(c);
    drawScale(c);
    if (sim.pts.length < 2 && !state.drawing) drawHint(c);
  }

  function channelFrac(i, n) { return n <= 1 ? 0 : i / (n - 1); }

  /** 岸點唔准畫過水線（避免河道多邊形「伸入海」） */
  function clampLandY(x, y) {
    const lim = sim.waterLineY(x) - 2;
    return y > lim ? lim : y;
  }

  /** 沿程變寬河道：用左右岸多邊形繪製 */
  function drawVariableChannel(c, land, g) {
    // 末端略為提早收束，交俾羽流溶入海，避免「河喺海面蜿蜒」
    const cut = Math.max(2, Math.floor(land.length * 0.97));
    land = land.slice(0, cut);
    const n = land.length;
    const left = [], right = [];
    for (let k = 0; k < n; k++) {
      const idx = Math.min(g.nx.length - 1, land[k].i != null ? land[k].i : k);
      const frac = channelFrac(k, n);
      let w = sim.widthAt(frac);
      // 最後一截逐漸透明感：闊度先略收再交羽流
      if (frac > 0.9) w *= 1 + (frac - 0.9) * 2.5;
      const nx = g.nx[idx] || 0, ny = g.ny[idx] || 1;
      const lx = land[k].x + nx * w * 0.5, ly = clampLandY(lx, land[k].y + ny * w * 0.5);
      const rx = land[k].x - nx * w * 0.5, ry = clampLandY(rx, land[k].y - ny * w * 0.5);
      left.push({ x: lx, y: ly });
      right.push({ x: rx, y: ry });
    }
    // 河岸
    c.beginPath();
    c.moveTo(left[0].x, left[0].y);
    for (const q of left) c.lineTo(q.x, q.y);
    for (let k = right.length - 1; k >= 0; k--) c.lineTo(right[k].x, right[k].y);
    c.closePath();
    c.fillStyle = '#a88b5c';
    c.fill();
    // 略內縮畫河水
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const idx = Math.min(g.nx.length - 1, land[k].i != null ? land[k].i : k);
      const frac = channelFrac(k, n);
      const w = sim.widthAt(frac) * 0.82;
      const nx = g.nx[idx] || 0, ny = g.ny[idx] || 1;
      const x = land[k].x + nx * w * 0.5, y = land[k].y + ny * w * 0.5;
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    for (let k = n - 1; k >= 0; k--) {
      const idx = Math.min(g.nx.length - 1, land[k].i != null ? land[k].i : k);
      const frac = channelFrac(k, n);
      const w = sim.widthAt(frac) * 0.82;
      const nx = g.nx[idx] || 0, ny = g.ny[idx] || 1;
      c.lineTo(land[k].x - nx * w * 0.5, land[k].y - ny * w * 0.5);
    }
    c.closePath();
    c.fillStyle = '#3b8fd8';
    c.fill();
    // 深泓線（偏外彎）
    c.strokeStyle = 'rgba(25,90,165,0.45)';
    c.lineWidth = Math.max(4, sim.widthAt(0.5) * 0.22);
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const idx = Math.min(g.cw.length - 1, land[k].i != null ? land[k].i : k);
      const w = sim.widthAt(channelFrac(k, n));
      const off = -Math.max(-0.25, Math.min(0.25, (g.cw[idx] || 0) * 0.85)) * w;
      const nx = g.nx[idx] || 0, ny = g.ny[idx] || 0;
      const x = land[k].x + nx * off, y = land[k].y + ny * off;
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  }

  /** 河口羽流：河道在三角洲尖端加闊、變淡，溶入海洋（唔再畫出海面河曲） */
  function drawMouthPlume(c, land) {
    if (land.length < 2) return;
    const tip = land[land.length - 1];
    const w = sim.mouthWidth;
    const hw = Math.max(w * 1.2, 40);
    // 喇叭口半透明
    const grd = c.createRadialGradient(tip.x, tip.y, w * 0.2, tip.x, tip.y + hw * 0.6, hw * 1.4);
    grd.addColorStop(0, 'rgba(80,160,210,0.55)');
    grd.addColorStop(0.45, 'rgba(70,140,195,0.28)');
    grd.addColorStop(1, 'rgba(60,120,180,0)');
    c.fillStyle = grd;
    c.beginPath();
    c.ellipse(tip.x, tip.y + hw * 0.35, hw * 0.95, hw * 0.7, 0, 0, Math.PI * 2);
    c.fill();
    // 短羽流條帶（向海淡出）
    c.strokeStyle = 'rgba(90,170,215,0.35)';
    c.lineWidth = w * 0.9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(tip.x, tip.y);
    c.lineTo(tip.x, Math.min(WH - 20, tip.y + hw * 0.85));
    c.stroke();
  }

  function drawCoastAndDelta(c) {
    const base = sim.baseCoastY;
    const step = 14;
    // 海洋：用水線 waterLineY（同物理截斷），避免河道喺「睇落係海、計落係陸」嘅區域蜿蜒
    c.beginPath();
    c.moveTo(0, WH);
    c.lineTo(WW, WH);
    c.lineTo(WW, sim.waterLineY(WW));
    for (let x = WW; x >= 0; x -= step) c.lineTo(x, sim.waterLineY(x));
    c.closePath();
    const sea = c.createLinearGradient(0, base, 0, WH);
    sea.addColorStop(0, '#5aa8d4');
    sea.addColorStop(0.45, '#3486b8');
    sea.addColorStop(1, '#1e5f90');
    c.fillStyle = sea;
    c.fill();

    // 三角洲沙洲：填滿 baseCoast → waterLine 之間嘅扇形（河道只喺沙洲上，唔喺開闊海）
    if (sim.deltaAdvance > 8 && sim.pts.length) {
      const mx = sim.pts[sim.pts.length - 1].x;
      const hw = Math.max(60, sim.deltaHalfW);
      c.beginPath();
      // 沿水線外側走扇緣
      for (let x = mx - hw; x <= mx + hw; x += step) {
        const y = sim.waterLineY(x);
        if (x === mx - hw) c.moveTo(x, base - 6);
        c.lineTo(x, y);
      }
      c.lineTo(mx + hw, base - 6);
      c.closePath();
      const tipY = sim.mouthY;
      const sand = c.createLinearGradient(0, base - 20, 0, tipY);
      sand.addColorStop(0, 'rgba(210,185,130,0.97)');
      sand.addColorStop(0.55, 'rgba(198,170,110,0.92)');
      sand.addColorStop(1, 'rgba(170,145,95,0.8)');
      c.fillStyle = sand;
      c.fill();
      c.strokeStyle = 'rgba(160,130,80,0.4)';
      c.lineWidth = 2;
      c.stroke();
    }

    // 浪紋（只在水線以南）
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
      const yy = base + sim.deltaAdvance * 0.5 + 40 + i * 28;
      if (yy > WH - 10) break;
      c.beginPath();
      for (let x = 0; x <= WW; x += 16) {
        const wave = Math.sin(x * 0.07 + i * 1.2 + sim.year * 0.02) * 3;
        const yl = Math.max(yy + wave, sim.waterLineY(x) + 6);
        x === 0 ? c.moveTo(x, yl) : c.lineTo(x, yl);
      }
      c.stroke();
    }
  }

  function drawDistributaries(c) {
    const arms = sim.distributaries();
    if (!arms.length) return;
    const w0 = Math.max(8, sim.mouthWidth * 0.28);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const arm of arms) {
      // 越近尖端越窄、越淡 → 溶入海
      for (let seg = 0; seg < arm.length - 1; seg++) {
        const t0 = seg / (arm.length - 1), t1 = (seg + 1) / (arm.length - 1);
        const w = w0 * (1 - t0 * 0.55);
        const alpha = 0.85 - t0 * 0.55;
        c.strokeStyle = `rgba(168,139,92,${alpha * 0.7})`;
        c.lineWidth = w + 6;
        c.beginPath(); c.moveTo(arm[seg].x, arm[seg].y); c.lineTo(arm[seg + 1].x, arm[seg + 1].y); c.stroke();
        c.strokeStyle = `rgba(74,154,208,${alpha})`;
        c.lineWidth = w;
        c.beginPath(); c.moveTo(arm[seg].x, arm[seg].y); c.lineTo(arm[seg + 1].x, arm[seg + 1].y); c.stroke();
      }
    }
  }

  function drawOxbow(c, o) {
    const fade = Math.max(0, 1 - o.age / 1100);
    const pts = o.pts.filter(q => q.y < sim.waterLineY(q.x) - 4);
    if (fade < 0.05 || pts.length < 4) return;
    const silt = Math.min(1, o.age / 650);
    const w = o.width * (0.95 - 0.45 * silt);
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = `rgba(180,165,120,${0.75 * fade})`;
    c.lineWidth = w + 10;
    pathOf(c, pts); c.stroke();
    const r = Math.round(70 + silt * 55);
    const gg = Math.round(95 + silt * 25);
    const b = Math.round(78 - silt * 25);
    c.strokeStyle = `rgba(${r},${gg},${b},${0.92 * fade})`;
    c.lineWidth = w;
    pathOf(c, pts); c.stroke();
    c.strokeStyle = `rgba(${r - 15},${gg - 10},${b - 10},${0.35 * fade})`;
    c.lineWidth = w * 0.45;
    pathOf(c, pts); c.stroke();
    const a0 = pts[0], z = pts[pts.length - 1];
    c.fillStyle = `rgba(190,175,130,${0.45 * fade})`;
    c.beginPath(); c.arc(a0.x, a0.y, w * 0.28, 0, 7); c.fill();
    c.beginPath(); c.arc(z.x, z.y, w * 0.28, 0, 7); c.fill();
  }

  function drawBars(c, land, g) {
    const n = land.length, thr = 0.07;
    let i = 0;
    while (i < n) {
      const i0 = Math.min(g.cw.length - 1, land[i].i != null ? land[i].i : i);
      if (Math.abs(g.cw[i0] || 0) <= thr) { i++; continue; }
      const sign = Math.sign(g.cw[i0]); let j = i;
      while (j < n) {
        const ij = Math.min(g.cw.length - 1, land[j].i != null ? land[j].i : j);
        if (Math.sign(g.cw[ij] || 0) !== sign || Math.abs(g.cw[ij] || 0) <= thr) break;
        j++;
      }
      if (j - i >= 2) {
        const outer = [], inner = [];
        for (let k = Math.max(0, i - 1); k <= Math.min(n - 1, j); k++) {
          const ik = Math.min(g.cw.length - 1, land[k].i != null ? land[k].i : k);
          const W = sim.widthAt(channelFrac(k, n));
          const a = Math.max(0, Math.abs(g.cw[ik] || 0) - thr);
          const bw = W * Math.min(0.5, 1.6 * a);
          const ex = W / 2 + 4;
          const nx = g.nx[ik] || 0, ny = g.ny[ik] || 0;
          outer.push({ x: land[k].x + nx * sign * ex, y: land[k].y + ny * sign * ex });
          inner.push({ x: land[k].x + nx * sign * (ex - bw - 4), y: land[k].y + ny * sign * (ex - bw - 4) });
        }
        c.beginPath(); c.moveTo(outer[0].x, outer[0].y);
        for (const q of outer) c.lineTo(q.x, q.y);
        for (let k = inner.length - 1; k >= 0; k--) c.lineTo(inner[k].x, inner[k].y);
        c.closePath();
        c.fillStyle = '#ecd59c'; c.fill();
        c.strokeStyle = 'rgba(190,160,95,0.8)'; c.lineWidth = 3; c.stroke();
      }
      i = Math.max(j, i + 1);
    }
  }

  function drawErosion(c, land, g) {
    let maxR = 1e-6;
    for (let i = 0; i < g.R.length; i++) maxR = Math.max(maxR, Math.abs(g.R[i]));
    c.lineCap = 'round';
    for (let i = 0; i < land.length - 1; i++) {
      const i0 = Math.min(g.R.length - 1, land[i].i != null ? land[i].i : i);
      const i1 = Math.min(g.R.length - 1, land[i + 1].i != null ? land[i + 1].i : i + 1);
      const r = ((g.R[i0] || 0) + (g.R[i1] || 0)) / 2;
      const a = Math.abs(r) / Math.max(maxR, 0.25);
      if (a < 0.18) continue;
      if (land[i].y > sim.waterLineY(land[i].x) - 30) continue;
      const W = sim.widthAt(channelFrac(i, land.length));
      const sgn = -Math.sign(r), off = W / 2 + 6;
      const x0 = land[i].x + (g.nx[i0] || 0) * sgn * off;
      const y0 = clampLandY(x0, land[i].y + (g.ny[i0] || 0) * sgn * off);
      const x1 = land[i + 1].x + (g.nx[i1] || 0) * sgn * off;
      const y1 = clampLandY(x1, land[i + 1].y + (g.ny[i1] || 0) * sgn * off);
      c.strokeStyle = `rgba(224,83,61,${Math.min(0.95, a)})`;
      c.lineWidth = 6 + 10 * Math.min(1, a);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    }
  }

  function drawParticles(c, land) {
    c.save(); c.lineCap = 'round';
    // 只在陸上河段顯示流動粒子；接近河口淡出；牛軛湖唔會有
    const tipY = land[land.length - 1].y;
    for (const q of state.particles) {
      if (q.lx == null || q.px == null) continue;
      if (q.py > tipY - 15) continue; // 入海／羽流區唔畫
      if (q.py > sim.waterLineY(q.px) - 2) continue;
      const a = toScreen({ x: q.lx, y: q.ly }), b = toScreen({ x: q.px, y: q.py });
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx * dx + dy * dy > 900) continue;
      const k = 3.2;
      c.strokeStyle = `rgba(255,255,255,${0.35 + 0.45 * Math.min(1, q.speed / 1.6)})`;
      c.lineWidth = 1.2 + q.speed * 0.8;
      c.beginPath(); c.moveTo(b.x - dx * k, b.y - dy * k); c.lineTo(b.x, b.y); c.stroke();
    }
    c.restore();
  }

  function pill(c, x, y, text, sub, bg) {
    c.font = '600 13px "Noto Sans TC","PingFang HK","Microsoft JhengHei",sans-serif';
    const w1 = c.measureText(text).width;
    c.font = '11px system-ui,sans-serif';
    const w2 = c.measureText(sub).width;
    const w = Math.max(w1, w2) + 18, h = 36;
    x = Math.max(4, Math.min(state.view.cw - w - 4, x - w / 2));
    y = Math.max(4, Math.min(state.view.ch - h - 4, y - h / 2));
    c.fillStyle = bg; c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, 9); else c.rect(x, y, w, h);
    c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.font = '600 13px "Noto Sans TC","PingFang HK","Microsoft JhengHei",sans-serif';
    c.fillText(text, x + w / 2, y + 16);
    c.font = '11px system-ui,sans-serif'; c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillText(sub, x + w / 2, y + 30);
  }

  function drawLabels(c, land) {
    const g = sim.geom, bends = sim.sharpestBends(state.view.cw < 640 ? 1 : 2);
    const nL = land.length;
    for (const i of bends) {
      // 只標示仍在陸上河段內的彎
      if (i >= g.cw.length) continue;
      const p = sim.pts[i];
      // 只標陸上河段；標籤位置若落喺海就跳過
      if (p.y > sim.waterLineY(p.x) - 40) continue;
      const sign = Math.sign(g.cw[i] || 1);
      const frac = i / Math.max(1, sim.pts.length - 1);
      const W = sim.widthAt(frac);
      const outer = { x: p.x - g.nx[i] * sign * (W / 2 + 8), y: p.y - g.ny[i] * sign * (W / 2 + 8) };
      const inner = { x: p.x + g.nx[i] * sign * (W / 2), y: p.y + g.ny[i] * sign * (W / 2) };
      const d = (state.view.cw < 640 ? 26 : 46) / state.view.s + W;
      const oL = { x: p.x - g.nx[i] * sign * d * 1.3, y: p.y - g.ny[i] * sign * d * 1.3 };
      const iL = { x: p.x + g.nx[i] * sign * d * 1.3, y: p.y + g.ny[i] * sign * d * 1.3 };
      for (const [aa, bb, t, sub, col] of [[outer, oL, '外彎 · 侵蝕', 'outer bank erosion', '#d2462f'], [inner, iL, '內彎 · 沉積', 'inner bank deposition', '#c08a1e']]) {
        if (aa.y > sim.waterLineY(aa.x) - 8 || bb.y > sim.waterLineY(bb.x) - 8) continue;
        const A = toScreen(aa), B = toScreen(bb);
        c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
        c.fillStyle = col; c.beginPath(); c.arc(A.x, A.y, 4, 0, 7); c.fill();
        pill(c, B.x, B.y, t, sub, col);
      }
    }
    for (const o of sim.oxbows) {
      if (o.age > 320) continue;
      const m = o.pts[Math.floor(o.pts.length / 2)];
      if (m.y > sim.waterLineY(m.x) - 20) continue;
      const s = toScreen(m);
      pill(c, s.x, s.y - 30, '漬水／牛軛湖', 'stagnant oxbow (yr ' + Math.round(o.year) + ')', '#4a5f48');
    }
    if (sim.deltaAdvance > 35 && land.length) {
      const tip = land[land.length - 1];
      const s = toScreen({ x: tip.x, y: (sim.baseCoastY + tip.y) / 2 });
      pill(c, s.x, s.y, '三角洲', 'delta · ' + Math.round(sim.deltaAdvance) + ' m', '#8a6a30');
    }
  }

  function drawEnds(c, land) {
    if (!land || land.length < 2) return;
    const a = toScreen(land[0]), b = toScreen(land[land.length - 1]);
    c.font = '600 12px "Noto Sans TC",sans-serif'; c.textAlign = 'center';
    const tags = [[a, '↑ 上游'], [b, '河口 ↓']];
    for (const [q, t] of tags) {
      c.fillStyle = 'rgba(31,45,39,0.78)';
      const w = c.measureText(t).width + 14;
      const x = Math.max(4, Math.min(state.view.cw - w - 4, q.x - w / 2));
      const y = Math.max(4, Math.min(state.view.ch - 26, q.y - (t.indexOf('上游') >= 0 ? -8 : 34)));
      c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, 22, 11); else c.rect(x, y, w, 22); c.fill();
      c.fillStyle = '#fff'; c.fillText(t, x + w / 2, y + 15);
    }
  }

  function drawOceanLabel(c) {
    const v = state.view;
    const midY = v.oy + Math.min(WH - 40, sim.baseCoastY + sim.deltaAdvance + OH * 0.35) * v.s;
    c.font = '600 14px "Noto Sans TC","PingFang HK",sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.textAlign = 'center';
    c.fillText('海洋 Ocean', v.ox + WW * v.s / 2, midY);
  }

  function drawScale(c) {
    // 放在陸地左下角（海洋帶之上），避免遮住海洋
    const v = state.view, len = 500 * v.s;
    const x = v.ox + 14, y = v.oy + Math.max(40, sim.baseCoastY - 30) * v.s;
    c.fillStyle = 'rgba(255,255,255,0.82)'; c.fillRect(x - 6, y - 20, len + 12, 28);
    c.fillStyle = '#1f2d27'; c.fillRect(x, y, len / 2, 4); c.fillStyle = '#fff'; c.strokeStyle = '#1f2d27';
    c.fillRect(x + len / 2, y, len / 2, 4); c.strokeRect(x, y, len, 4);
    c.fillStyle = '#1f2d27'; c.font = '11px system-ui,sans-serif'; c.textAlign = 'left'; c.fillText('0', x, y - 5);
    c.textAlign = 'right'; c.fillText('500 m', x + len, y - 5);
  }

  function drawHint(c) {
    const v = state.view;
    c.fillStyle = 'rgba(255,255,255,0.9)';
    const w = Math.min(480, v.cw - 30), h = 78, x = (v.cw - w) / 2, y = (v.ch - h) / 2 - 30;
    c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, 14); else c.rect(x, y, w, h); c.fill();
    c.fillStyle = '#1f2d27'; c.textAlign = 'center';
    c.font = '600 15px "Noto Sans TC","PingFang HK",sans-serif';
    c.fillText('✏️ 由上方（上游）畫到下方（河口／海洋）', v.cw / 2, y + 30);
    c.font = '13px "Noto Sans TC","PingFang HK",sans-serif'; c.fillStyle = '#5d6b63';
    c.fillText('或按「示範河道」載入例子', v.cw / 2, y + 54);
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }
  function setRunning(r) {
    if (r && sim.pts.length < 3) { toast('請先畫河道或載入示範河道'); r = false; }
    state.running = r;
    $('btnPlay').innerHTML = r ? '⏸ 暫停<small>Pause</small>' : '▶ 開始<small>Start</small>';
    if (r) setDrawMode(false);
  }
  function setDrawMode(on) {
    state.drawMode = on;
    $('btnDraw').setAttribute('aria-pressed', on ? 'true' : 'false');
    canvas.classList.toggle('drawing', on);
    if (on) { setRunning(false); toast('由上方（上游）畫到下方（河口），放手完成'); }
  }
  function loadPath(pts) {
    sim.setPath(pts); clearHistory(); initParticles(); state.lastCutoffs = sim.cutoffs; stampHistory();
    updateStats();
  }
  function updateStats() {
    $('year').textContent = Math.floor(sim.year);
    $('sW').textContent = Math.round(sim.upstreamWidth) + '→' + Math.round(sim.mouthWidth);
    $('sH').textContent = sim.depth.toFixed(1);
    const has = sim.pts.length >= 2;
    $('sS').textContent = has ? sim.sinuosity().toFixed(2) : '–';
    $('sL').textContent = has ? (sim.geom.length / 1000).toFixed(2) : '–';
    $('sR').textContent = has && sim.year > 0 ? sim.meanRate.toFixed(1) : '–';
    $('sO').textContent = sim.oxbows.length;
    if ($('sWiden')) $('sWiden').textContent = has ? (sim.widenRatio.toFixed(2) + '×') : '–';
    if ($('sDelta')) $('sDelta').textContent = has ? Math.round(sim.deltaAdvance) : '–';
  }

  $('btnDraw').onclick = () => setDrawMode(!state.drawMode);
  $('btnPreset').onclick = () => { setDrawMode(false); setRunning(false); loadPath(RiverSim.presetPath(WW, WH, OH)); toast('已載入示範河道（上→下流入海），按「開始」'); };
  $('btnClear').onclick = () => { setRunning(false); sim.reset(); clearHistory(); updateStats(); setDrawMode(true); };
  $('btnPlay').onclick = () => setRunning(!state.running);
  $('btnReset').onclick = () => { setRunning(false); if (sim.initial) { sim.restart(); clearHistory(); stampHistory(); initParticles(); updateStats(); toast('已重設到第 0 年'); } };

  const q = $('q'), vv = $('v'), t = $('t');
  q.oninput = () => { sim.Q = +q.value; $('qVal').textContent = q.value; sim.onParamChange(); updateStats(); };
  vv.oninput = () => { sim.v = +vv.value; $('vVal').textContent = (+vv.value).toFixed(1); sim.onParamChange(); updateStats(); };
  t.oninput = () => { state.timeSpeed = +t.value; $('tVal').textContent = t.value; };
  $('lyParticles').onchange = e => state.layers.particles = e.target.checked;
  $('lyLabels').onchange = e => state.layers.labels = e.target.checked;
  $('lyHistory').onchange = e => state.layers.history = e.target.checked;
  window.addEventListener('keydown', e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); setRunning(!state.running); } });

  function evPos(e) { const r = canvas.getBoundingClientRect(); return toWorld(e.clientX - r.left, e.clientY - r.top); }
  canvas.addEventListener('pointerdown', e => {
    if (!state.drawMode && sim.pts.length >= 2) return;
    if (!state.drawMode) setDrawMode(true);
    canvas.setPointerCapture(e.pointerId);
    state.drawing = [evPos(e)];
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (!state.drawing) return;
    const p = evPos(e), last = state.drawing[state.drawing.length - 1];
    p.x = Math.min(WW - 20, Math.max(20, p.x));
    p.y = Math.min(sim.baseCoastY - 10, Math.max(20, p.y)); // 只可畫在陸地上
    if (Math.hypot(p.x - last.x, p.y - last.y) > 12) state.drawing.push(p);
  });
  const finish = () => {
    if (!state.drawing) return;
    const pts = state.drawing; state.drawing = null;
    if (RiverSim.polyLength(pts) < 500) { toast('河道太短，請畫長一點（至少 500 米）'); return; }
    loadPath(pts); setDrawMode(false);
    toast(sim.cutoffs ? '河道交叉，已自動截彎取直。按「開始」' : '完成！河道會流入下方海洋。按「開始」');
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  function frame(now) {
    const dt = Math.min(0.1, (now - state.lastT) / 1000); state.lastT = now;
    if (state.running && sim.pts.length >= 3) {
      sim.advance(state.timeSpeed * dt);
      if (sim.year - state.lastHistYear >= 3) { stampHistory(); state.lastHistYear = sim.year; }
      if (sim.cutoffs > state.lastCutoffs) {
        for (let k = state.lastCutoffs; k < sim.cutoffs; k++) {
          const o = sim.oxbows[sim.oxbows.length - (sim.cutoffs - k)]; if (o) stampOxbow(o);
        }
        state.lastCutoffs = sim.cutoffs;
        toast(`第 ${Math.floor(sim.year)} 年：曲流頸被沖穿，截彎取直形成牛軛湖！`, 3500);
      }
      updateStats();
    }
    updateParticles(dt);
    draw();
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('canvasWrap'));
  resize(); updateStats(); initParticles();
  loadPath(RiverSim.presetPath(WW, WH, OH));
  toast('上方＝上游，下方＝三角洲／海洋。河曲唔會被邊框彈開', 3500);
  requestAnimationFrame(frame);
})();
