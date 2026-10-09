/* 河曲模擬核心 — 簡化中心線遷移模型（參考 Howard & Knutson, 1984）
 * 可在瀏覽器（window.RiverSim）或 Node（module.exports）使用。 */
(function (root) {
  'use strict';

  function wallFactor(m) {
    const t = Math.min(1, Math.max(0, (m - 20) / 180));
    return t * t * (3 - 2 * t);
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    return L;
  }

  // 依固定間距重新取樣（保留兩端）
  function resample(pts, ds) {
    if (pts.length < 2) return pts.slice();
    const L = polyLength(pts);
    const n = Math.max(2, Math.round(L / ds));
    const step = L / n;
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let seg = 1, segStart = 0, segLen = dist(pts[0], pts[1]);
    for (let k = 1; k < n; k++) {
      const target = k * step;
      while (segStart + segLen < target && seg < pts.length - 1) {
        segStart += segLen; seg++; segLen = dist(pts[seg - 1], pts[seg]);
      }
      const t = segLen > 0 ? (target - segStart) / segLen : 0;
      const a = pts[seg - 1], b = pts[seg];
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    const last = pts[pts.length - 1];
    out.push({ x: last.x, y: last.y });
    return out;
  }

  // Chaikin 平滑（保留兩端）
  function chaikin(pts, iters) {
    let p = pts;
    for (let it = 0; it < iters; it++) {
      if (p.length < 3) return p;
      const q = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        q.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
        q.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
      }
      q.push(p[p.length - 1]);
      p = q;
    }
    return p;
  }

  class RiverSim {
    constructor(opts) {
      opts = opts || {};
      this.worldW = opts.worldW || 3000;   // 米
      this.worldH = opts.worldH || 1800;
      this.Q = opts.Q || 600;              // 流量 m³/s
      this.v = opts.v || 1.2;              // 流速 m/s
      this.omega = -1.0;                   // 局部曲率項
      this.gamma = 2.5;                    // 上游滯後曲率項
      this.lagWidths = 1.5;                // 滯後衰減長度（以河寬計）
      this.baseRate = 18;
      this.noiseAmp = 0.15;
      this.ph1 = Math.random() * 6.28; this.ph2 = Math.random() * 6.28;                  // 基本遷移係數 (m/年 / 無因次曲率)
      this.reset();
    }

    reset() {
      this.pts = [];
      this.initial = null;
      this.oxbows = [];
      this.year = 0;
      this.cutoffs = 0;
      this.meanRate = 0;
      this.events = [];
      this.geom = null;
    }

    get width() { return 3.2 * Math.sqrt(this.Q); }      // 河寬隨流量增加
    get depth() { return this.Q / (this.width * this.v); } // Q = W·h·v
    get ds() { return this.width * 0.5; }
    get erodibility() { // m/年，每單位無因次曲率
      return this.baseRate * Math.pow(this.v / 1.2, 1.5) * Math.pow(this.Q / 600, 0.5);
    }

    setPath(points) {
      this.reset();
      if (!points || points.length < 2) return false;
      let p = points.map(q => ({ x: q.x, y: q.y }));
      p = resample(p, Math.max(5, this.ds / 3));
      p = chaikin(p, 2);
      p = resample(p, this.ds);
      this.pts = p;
      this.initial = p.map(q => ({ x: q.x, y: q.y }));
      this.computeGeom();
      // 起始時若已自交，先截彎
      this.checkCutoffs();
      return true;
    }

    restart() {
      if (!this.initial) return;
      const init = this.initial;
      this.reset();
      this.initial = init;
      this.pts = resample(init, this.ds);
      this.computeGeom();
    }

    onParamChange() {
      if (this.pts.length >= 2) {
        this.pts = resample(this.pts, this.ds);
        this.computeGeom();
      }
    }

    computeGeom() {
      const p = this.pts, n = p.length, W = this.width;
      const tx = new Float64Array(n), ty = new Float64Array(n);
      const nx = new Float64Array(n), ny = new Float64Array(n);
      const C = new Float64Array(n), s = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
        let dx = b.x - a.x, dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        tx[i] = dx / l; ty[i] = dy / l;
        nx[i] = -ty[i]; ny[i] = tx[i];
        if (i > 0) s[i] = s[i - 1] + dist(p[i - 1], p[i]);
      }
      for (let i = 1; i < n - 1; i++) {
        const ax = p[i].x - p[i - 1].x, ay = p[i].y - p[i - 1].y;
        const bx = p[i + 1].x - p[i].x, by = p[i + 1].y - p[i].y;
        const ang = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
        const l = (Math.hypot(ax, ay) + Math.hypot(bx, by)) / 2 || 1;
        C[i] = ang / l;
      }
      // 曲率平滑 (1-2-1) ×2
      let cw = new Float64Array(n);
      for (let i = 0; i < n; i++) cw[i] = C[i] * W;
      for (let pass = 0; pass < 2; pass++) {
        const t = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const l = cw[Math.max(0, i - 1)], r = cw[Math.min(n - 1, i + 1)];
          t[i] = 0.25 * l + 0.5 * cw[i] + 0.25 * r;
        }
        t[0] = 0; t[n - 1] = 0;
        cw = t;
      }
      // 上游滯後曲率（水流由第一點流向最後一點）
      const ds = n > 1 ? s[n - 1] / (n - 1) : 1;
      const L = this.lagWidths * W;
      const K = Math.max(1, Math.ceil(4 * L / ds));
      const wts = [];
      for (let k = 1; k <= K; k++) wts.push(Math.exp(-k * ds / L));
      const R = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let acc = 0, ws = 0;
        for (let k = 1; k <= K && i - k >= 0; k++) { acc += cw[i - k] * wts[k - 1]; ws += wts[k - 1]; }
        const lag = ws > 0 ? acc / ws : cw[i];
        R[i] = this.omega * cw[i] + this.gamma * lag;
        // 細微隨機擾動：令直河段亦會慢慢發展出新河曲
        R[i] += this.noiseAmp * Math.sin(2 * Math.PI * s[i] / (12 * W) + this.ph1) * Math.sin(2 * Math.PI * s[i] / (37 * W) + this.ph2);
      }
      this.geom = { tx, ty, nx, ny, cw, R, s, length: n ? s[n - 1] : 0 };
      return this.geom;
    }

    // 向外遷移：曲率 >0 表示向 +n 方向轉，外彎在 -n 方向
    step(dt) {
      const p = this.pts, n = p.length;
      if (n < 3) return 0;
      const g = this.geom || this.computeGeom();
      const E = this.erodibility;
      const ds = this.ds;
      let sum = 0;
      const np = new Array(n);
      for (let i = 0; i < n; i++) {
        let taper = 1;
        const edge = Math.min(i, n - 1 - i);
        if (edge < 4) taper = edge / 4;
        let d = E * g.R[i] * dt * taper;
        const lim = 0.25 * ds;
        if (d > lim) d = lim; else if (d < -lim) d = -lim;
        sum += Math.abs(d);
        let mx = -g.nx[i] * d, my = -g.ny[i] * d;
        // 谷壁（地圖邊緣）較難侵蝕：靠近邊緣時減慢向外遷移
        const px = p[i].x, py = p[i].y;
        const ex = px < this.worldW / 2 ? px : this.worldW - px;
        const ey = py < this.worldH / 2 ? py : this.worldH - py;
        const towardX = (px < this.worldW / 2 ? -mx : mx) > 0;
        const towardY = (py < this.worldH / 2 ? -my : my) > 0;
        if (towardX) mx *= wallFactor(ex);
        if (towardY) my *= wallFactor(ey);
        let x = Math.min(this.worldW - 10, Math.max(10, px + mx));
        let y = Math.min(this.worldH - 10, Math.max(10, py + my));
        np[i] = { x, y };
      }
      np[0] = p[0]; np[n - 1] = p[n - 1];
      // 輕微平滑以抑制數值噪音
      const a = Math.min(0.05, 0.005 * dt);
      const sm = np.map(q => ({ x: q.x, y: q.y }));
      for (let i = 1; i < n - 1; i++) {
        sm[i].x += a * (np[i - 1].x + np[i + 1].x - 2 * np[i].x);
        sm[i].y += a * (np[i - 1].y + np[i + 1].y - 2 * np[i].y);
      }
      this.pts = resample(sm, ds);
      this.year += dt;
      this.ph1 += (Math.random() - 0.5) * 0.4 * Math.sqrt(dt);
      this.ph2 += (Math.random() - 0.5) * 0.4 * Math.sqrt(dt);
      for (const o of this.oxbows) o.age += dt;
      this.oxbows = this.oxbows.filter(o => o.age < 900);
      this.checkCutoffs();
      this.computeGeom();
      const rate = sum / n / dt;
      this.meanRate = this.meanRate ? this.meanRate * 0.9 + rate * 0.1 : rate;
      return rate;
    }

    advance(years) {
      if (this.pts.length < 3 || years <= 0) return;
      let remain = years, guard = 0;
      while (remain > 1e-9 && guard++ < 200) {
        const g = this.geom || this.computeGeom();
        let maxR = 1e-6;
        for (let i = 0; i < g.R.length; i++) maxR = Math.max(maxR, Math.abs(g.R[i]));
        const dtMax = Math.min(2, (0.2 * this.ds) / (this.erodibility * maxR));
        const dt = Math.min(remain, dtMax);
        this.step(dt);
        remain -= dt;
      }
    }

    // 截彎取直：非相鄰河段距離 < 河寬 → 形成牛軛湖
    checkCutoffs() {
      let found = true, loops = 0;
      while (found && loops++ < 5) {
        found = false;
        const p = this.pts, n = p.length, W = this.width;
        if (n < 10) return;
        const thr = W * 1.05;
        const minSep = Math.ceil((4 * W) / this.ds);
        const cell = thr, grid = new Map();
        const key = (cx, cy) => cx * 100003 + cy;
        for (let i = 0; i < n; i++) {
          const k = key(Math.floor(p[i].x / cell), Math.floor(p[i].y / cell));
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(i);
        }
        let best = null;
        for (let i = 0; i < n && !best; i++) {
          const cx = Math.floor(p[i].x / cell), cy = Math.floor(p[i].y / cell);
          for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
            const list = grid.get(key(cx + ox, cy + oy));
            if (!list) continue;
            for (const j of list) {
              if (j - i < minSep) continue;
              if (dist(p[i], p[j]) < thr && (!best || j - i > best[1] - best[0])) best = [i, j];
            }
          }
        }
        if (best) {
          const [i, j] = best;
          const ox = p.slice(i, j + 1).map(q => ({ x: q.x, y: q.y }));
          this.oxbows.push({ pts: ox, age: 0, width: W, year: this.year });
          const np = p.slice(0, i + 1).concat(p.slice(j));
          // 接口附近局部平滑
          for (let it = 0; it < 6; it++) {
            for (let k = Math.max(1, i - 4); k <= Math.min(np.length - 2, i + 4); k++) {
              np[k] = { x: (np[k - 1].x + 2 * np[k].x + np[k + 1].x) / 4, y: (np[k - 1].y + 2 * np[k].y + np[k + 1].y) / 4 };
            }
          }
          this.pts = resample(np, this.ds);
          this.cutoffs++;
          this.events.push({ type: 'cutoff', year: this.year });
          found = true;
          this.computeGeom();
        }
      }
    }

    sinuosity() {
      const p = this.pts;
      if (p.length < 2) return 1;
      const d = dist(p[0], p[p.length - 1]);
      return d > 0 ? polyLength(p) / d : 1;
    }

    // 找出最急的彎位（作標示用）
    sharpestBends(maxCount) {
      const g = this.geom; if (!g) return [];
      const n = this.pts.length, cw = g.cw, cand = [];
      for (let i = 2; i < n - 2; i++) {
        const a = Math.abs(cw[i]);
        if (a > 0.12 && a >= Math.abs(cw[i - 1]) && a >= Math.abs(cw[i + 1])) cand.push(i);
      }
      cand.sort((a, b) => Math.abs(cw[b]) - Math.abs(cw[a]));
      const out = [], minGap = 8 * this.width;
      for (const i of cand) {
        if (out.every(j => Math.abs(g.s[i] - g.s[j]) > minGap)) out.push(i);
        if (out.length >= (maxCount || 2)) break;
      }
      return out;
    }

    static presetPath(worldW, worldH) {
      const pts = [];
      const x0 = worldW * 0.06, x1 = worldW * 0.94;
      for (let k = 0; k <= 200; k++) {
        const t = k / 200, x = x0 + (x1 - x0) * t;
        const env = Math.sin(Math.PI * t);
        const y = worldH / 2 + worldH * 0.12 * env * Math.sin(2 * Math.PI * t * 3.4 + 0.3)
          + worldH * 0.04 * Math.sin(2 * Math.PI * t * 7.1);
        pts.push({ x, y });
      }
      return pts;
    }
  }

  RiverSim.resample = resample;
  RiverSim.chaikin = chaikin;
  RiverSim.polyLength = polyLength;

  if (typeof module !== 'undefined' && module.exports) module.exports = RiverSim;
  else root.RiverSim = RiverSim;
})(typeof window !== 'undefined' ? window : this);
