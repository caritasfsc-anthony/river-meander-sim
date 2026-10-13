/* 河曲模擬核心 — 簡化中心線遷移模型（參考 Howard & Knutson, 1984）
 * 地圖：上方＝上游（高地），下方＝河口／三角洲／海洋。
 * 無硬邊框牆；河口隨三角洲前進；牛軛湖需曲流頸明顯變窄才截彎。
 */
(function (root) {
  'use strict';

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    return L;
  }

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
      this.worldW = opts.worldW || 2200;
      this.worldH = opts.worldH || 3000;
      this.oceanH = opts.oceanH || 480;    // 更大海洋帶，方便三角洲前進
      this.Q = opts.Q || 600;
      this.v = opts.v || 1.2;
      this.omega = -1.0;
      this.gamma = 2.5;
      this.lagWidths = 1.5;
      this.baseRate = 18;
      this.noiseAmp = 0.15;
      this.ph1 = Math.random() * 6.28;
      this.ph2 = Math.random() * 6.28;
      this.widenScale = 0.05;
      this.cutoffCooldown = 0;
      this.neckTimer = 0;
      this.pendingNeck = null;
      this.reset();
    }

    /** 原始海岸線 y（三角洲由此向海推進） */
    get baseCoastY() { return this.worldH - this.oceanH; }

    /** 目前河口／三角洲尖端的大約 y */
    get mouthY() {
      return Math.min(this.worldH - 40, this.baseCoastY + this.deltaAdvance * 0.92);
    }

    get baseWidth() { return 3.2 * Math.sqrt(this.Q); }

    get width() {
      const base = this.baseWidth;
      const ceil = base * 2.6;
      const extra = (ceil - base) * (1 - Math.exp(-this.erosionWiden / (base * 2.2)));
      return base + extra;
    }

    get depth() { return this.Q / (this.width * this.v); }
    get ds() { return Math.max(22, this.baseWidth * 0.42); }
    get erodibility() {
      return this.baseRate * Math.pow(this.v / 1.2, 1.5) * Math.pow(this.Q / 600, 0.5);
    }
    get widenRatio() { return this.width / this.baseWidth; }

    /** 三角洲寬度（扇形半寬約） */
    get deltaHalfW() {
      return 80 + this.deltaAdvance * 1.15 + this.width * 0.8;
    }

    reset() {
      this.pts = [];
      this.initial = null;
      this.sourceAnchor = null;
      this.oxbows = [];
      this.year = 0;
      this.cutoffs = 0;
      this.meanRate = 0;
      this.events = [];
      this.geom = null;
      this.erosionWiden = 0;
      this.sediment = 0;
      this.deltaAdvance = 0; // 米，向海推進距離
      this.cutoffCooldown = 0;
      this.neckTimer = 0;
      this.pendingNeck = null;
    }

    setPath(points) {
      this.reset();
      if (!points || points.length < 2) return false;
      let p = points.map(q => ({ x: q.x, y: q.y }));
      if (p[0].y > p[p.length - 1].y) p = p.slice().reverse();
      // 河口對齊到原始海岸附近
      const last = p[p.length - 1];
      last.y = Math.min(last.y, this.baseCoastY - 5);
      p = resample(p, Math.max(5, this.ds / 3));
      p = chaikin(p, 2);
      p = resample(p, this.ds);
      this.pts = p;
      this.initial = p.map(q => ({ x: q.x, y: q.y }));
      this.sourceAnchor = { x: p[0].x, y: p[0].y };
      this.computeGeom();
      // 初始自交仍可截彎（教學用），但用較嚴門檻
      this.checkCutoffs(true);
      return true;
    }

    restart() {
      if (!this.initial) return;
      const init = this.initial;
      const anchor = this.sourceAnchor;
      this.reset();
      this.initial = init;
      this.sourceAnchor = anchor || { x: init[0].x, y: init[0].y };
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
        R[i] += this.noiseAmp * Math.sin(2 * Math.PI * s[i] / (12 * W) + this.ph1)
          * Math.sin(2 * Math.PI * s[i] / (37 * W) + this.ph2);
      }
      this.geom = { tx, ty, nx, ny, cw, R, s, length: n ? s[n - 1] : 0 };
      return this.geom;
    }

    /**
     * 極軟邊界：視圖邊框不是牆。
     * 只在遠超出可見區（約 ±350 m）時輕輕拉回，避免數值失控。
     */
    softConfine(x, y, mx, my) {
      // 視圖邊框不是牆。可見區內自由；僅當位移指向界外時減弱該分量。
      let nx = x, ny = y;
      const band = 120;
      // 左緣：若向左移出，按接近程度減弱
      if (x < band && mx < 0) {
        const t = Math.max(0, x / band);
        nx = (x - mx) + mx * (0.2 + 0.8 * t);
      }
      if (x > this.worldW - band && mx > 0) {
        const t = Math.max(0, (this.worldW - x) / band);
        nx = (x - mx) + mx * (0.2 + 0.8 * t);
      }
      // 遠出可見區外才拉回（防數值失控）
      if (nx < -300) nx = -300 + (nx + 300) * 0.5;
      if (nx > this.worldW + 300) nx = this.worldW + 300 + (nx - this.worldW - 300) * 0.5;
      if (ny < 10) ny = 10;
      if (ny > this.worldH - 18) ny = this.worldH - 18;
      return { x: nx, y: ny };
    }

        step(dt) {
      const p = this.pts, n = p.length;
      if (n < 3) return 0;
      const g = this.geom || this.computeGeom();
      const E = this.erodibility;
      const ds = this.ds;
      let sum = 0;
      const np = new Array(n);

      const sinNow = this.sinuosity();
      const sinDamp = Math.min(1, 3.0 / Math.max(1.2, sinNow));
      for (let i = 0; i < n; i++) {
        // 近源／近口略為減弱遷移，避免端點堆彎，但唔係硬牆
        let taper = 1;
        const frac = i / (n - 1);
        if (frac < 0.06) taper = frac / 0.06;
        else if (frac > 0.92) taper = (1 - frac) / 0.08;
        taper = Math.max(0.05, taper);

        let d = E * g.R[i] * dt * taper * (0.55 + 0.45 * sinDamp);
        const lim = 0.25 * ds;
        if (d > lim) d = lim; else if (d < -lim) d = -lim;
        sum += Math.abs(d);

        let mx = -g.nx[i] * d, my = -g.ny[i] * d;
        const c = this.softConfine(p[i].x + mx, p[i].y + my, mx, my);
        np[i] = c;
      }

      // 上游：彈簧拉向 sourceAnchor（可輕微漂移）
      if (this.sourceAnchor) {
        const k = 0.35;
        np[0] = {
          x: p[0].x + (this.sourceAnchor.x - p[0].x) * k * Math.min(1, dt),
          y: p[0].y + (this.sourceAnchor.y - p[0].y) * k * Math.min(1, dt)
        };
      }

      // 河口：跟隨三角洲尖端，並允許橫向輕微漂移（唔再釘死）
      const mouthTargetY = this.mouthY;
      const last = n - 1;
      const driftX = (np[last].x - p[last].x) * 0.55; // 保留部分遷移
      np[last] = {
        x: p[last].x + driftX,
        y: p[last].y + (mouthTargetY - p[last].y) * Math.min(1, 0.4 * dt + 0.08)
      };

      const a = Math.min(0.05, 0.005 * dt);
      const sm = np.map(q => ({ x: q.x, y: q.y }));
      for (let i = 1; i < n - 1; i++) {
        sm[i].x += a * (np[i - 1].x + np[i + 1].x - 2 * np[i].x);
        sm[i].y += a * (np[i - 1].y + np[i + 1].y - 2 * np[i].y);
      }
      // 保持大致由上至下
      if (sm[0].y > sm[last].y - 100) sm[last].y = sm[0].y + 100;

      let nxt = resample(sm, ds);
      // 節點上限：過長時略為加大間距，避免失控
      if (nxt.length > 420) nxt = resample(sm, ds * (nxt.length / 380));
      this.pts = nxt;
      this.year += dt;
      this.ph1 += (Math.random() - 0.5) * 0.4 * Math.sqrt(dt);
      this.ph2 += (Math.random() - 0.5) * 0.4 * Math.sqrt(dt);
      if (this.cutoffCooldown > 0) this.cutoffCooldown = Math.max(0, this.cutoffCooldown - dt);
      if (this.pendingNeck) this.neckTimer += dt;

      const meanMig = sum / n;
      this.erosionWiden += meanMig * this.widenScale;

      // 泥沙收支 → 三角洲前進（流量、侵蝕加闊越大，沉積越多）
      const sedRate = 0.55 * (this.Q / 600) * (0.45 + this.widenRatio * 0.35) * (0.7 + this.v / 1.2 * 0.3);
      this.sediment += sedRate * dt;
      const maxAdv = this.oceanH * 0.78;
      const targetAdv = maxAdv * (1 - Math.exp(-this.sediment / 180));
      this.deltaAdvance += (targetAdv - this.deltaAdvance) * Math.min(1, 0.15 * dt);

      for (const o of this.oxbows) o.age += dt;
      this.oxbows = this.oxbows.filter(o => o.age < 1100 && this.oxbowOnLand(o));
      this.checkCutoffs(false);
      this.computeGeom();
      const rate = meanMig / Math.max(dt, 1e-6);
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
        const dtMax = Math.min(2, (0.2 * this.ds) / (this.erodibility * maxR + 1e-9));
        const dt = Math.min(remain, dtMax);
        this.step(dt);
        remain -= dt;
      }
    }

    oxbowOnLand(o) {
      // 唔好整條都喺海裏面
      let sea = 0;
      const coast = this.baseCoastY + Math.max(20, this.deltaAdvance * 0.15);
      for (const q of o.pts) if (q.y > coast) sea++;
      return sea < o.pts.length * 0.65;
    }

    /**
     * 截彎取直：曲流頸必須明顯窄於河寬，需持續一段時間，且避開源／口。
     * @param {boolean} immediate 初始自交時可即時截彎
     */
    checkCutoffs(immediate) {
      if (!immediate && this.cutoffCooldown > 0) return;
      const p = this.pts, n = p.length, W = this.width;
      if (n < 14) return;

      // 河岸幾乎相觸（約一個河寬）才截；高彎曲度時略放寬
      const sin = this.sinuosity();
      const thr = W * (immediate ? 1.0 : (sin > 3.2 ? 1.15 : sin > 2.5 ? 0.95 : 0.8));
      const minAlong = Math.max(8, Math.ceil((5.5 * W) / this.ds));
      const marginNodes = Math.max(5, Math.ceil(n * 0.06));

      const cell = Math.max(thr, 16), grid = new Map();
      const key = (cx, cy) => cx * 100003 + cy;
      for (let i = marginNodes; i < n - marginNodes; i++) {
        const k = key(Math.floor(p[i].x / cell), Math.floor(p[i].y / cell));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }

      let best = null, bestScore = -1;
      for (let i = marginNodes; i < n - marginNodes; i++) {
        if (p[i].y > this.baseCoastY - 50) continue;
        const cx = Math.floor(p[i].x / cell), cy = Math.floor(p[i].y / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const list = grid.get(key(cx + ox, cy + oy));
          if (!list) continue;
          for (const j of list) {
            if (j - i < minAlong || j >= n - marginNodes) continue;
            if (p[j].y > this.baseCoastY - 50) continue;
            const d = dist(p[i], p[j]);
            if (d >= thr) continue;
            const loopLen = polyLength(p.slice(i, j + 1));
            const loopSin = loopLen / (d || 1);
            if (loopSin < (immediate ? 2.0 : 2.4)) continue;
            const score = loopSin / (d / W + 0.25);
            if (score > bestScore) { bestScore = score; best = [i, j, d, loopSin]; }
          }
        }
      }

      if (!best) { this.pendingNeck = null; this.neckTimer = 0; return; }

      const [i, j, d, loopSin] = best;
      // 頸已夠窄（d < thr）且環路夠彎即截；靠 cooldown 避免連斬
      if (!immediate && d > W * 0.95 && this.sinuosity() < 3.0) return;

      const oxPts = p.slice(i, j + 1).map(q => ({ x: q.x, y: q.y }));
      if (oxPts.length >= 6 && this.oxbowOnLand({ pts: oxPts })) {
        this.oxbows.push({ pts: oxPts, age: 0, width: W * 0.9, year: this.year, closed: true });
      }

      const np = p.slice(0, i + 1).concat(p.slice(j));
      for (let it = 0; it < 14; it++) {
        for (let k = Math.max(1, i - 6); k <= Math.min(np.length - 2, i + 6); k++) {
          np[k] = {
            x: (np[k - 1].x + 2 * np[k].x + np[k + 1].x) / 4,
            y: (np[k - 1].y + 2 * np[k].y + np[k + 1].y) / 4
          };
        }
      }
      let out = resample(np, this.ds);
      if (out.length > 420) out = resample(np, this.ds * (out.length / 380));
      this.pts = out;
      this.cutoffs++;
      this.events.push({ type: 'cutoff', year: this.year, loopSin, neck: d });
      this.cutoffCooldown = 65;
      this.pendingNeck = null;
      this.neckTimer = 0;
      this.computeGeom();
    }

    /** 海岸線 y(x)：三角洲扇形凸出 */
    coastY(x) {
      const base = this.baseCoastY;
      const adv = this.deltaAdvance;
      if (adv < 1 || !this.pts.length) return base;
      const mx = this.pts[this.pts.length - 1].x;
      const hw = this.deltaHalfW;
      const u = (x - mx) / hw;
      if (Math.abs(u) > 1.2) return base;
      // 平滑扇形：中央突出最多
      const lobe = Math.exp(-u * u * 1.8) * (1 - Math.abs(u) * 0.15);
      const ripple = 0.08 * Math.sin(u * 9 + this.year * 0.01);
      return base + adv * Math.max(0, lobe + ripple);
    }

    /** 分流河道（教學用 2–3 支） */
    distributaries() {
      if (this.deltaAdvance < 25 || this.pts.length < 2) return [];
      const mouth = this.pts[this.pts.length - 1];
      const adv = this.deltaAdvance;
      const hw = this.deltaHalfW;
      const arms = [];
      const angles = [-0.55, 0.05, 0.55];
      const nArms = adv > 90 ? 3 : 2;
      for (let a = 0; a < nArms; a++) {
        const ang = angles[a] + (a === 1 ? 0 : 0);
        const len = adv * (0.75 + (a === 1 ? 0.2 : 0));
        const tip = {
          x: mouth.x + Math.sin(ang) * hw * 0.55,
          y: mouth.y + Math.cos(ang) * len * 0.85
        };
        // 中間控制點
        const mid = {
          x: mouth.x + Math.sin(ang) * hw * 0.28,
          y: mouth.y + Math.cos(ang) * len * 0.4
        };
        arms.push([
          { x: mouth.x, y: mouth.y },
          mid,
          tip
        ]);
      }
      return arms;
    }

    sinuosity() {
      const p = this.pts;
      if (p.length < 2) return 1;
      const d = dist(p[0], p[p.length - 1]);
      return d > 0 ? polyLength(p) / d : 1;
    }

    sharpestBends(maxCount) {
      const g = this.geom; if (!g) return [];
      const n = this.pts.length, cw = g.cw, cand = [];
      const lo = Math.floor(n * 0.08), hi = Math.floor(n * 0.88);
      for (let i = Math.max(2, lo); i < Math.min(n - 2, hi); i++) {
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

    static presetPath(worldW, worldH, oceanH) {
      oceanH = oceanH == null ? 480 : oceanH;
      const landH = worldH - oceanH;
      const pts = [];
      const y0 = worldH * 0.05, y1 = landH - 15;
      const cx = worldW * 0.5;
      for (let k = 0; k <= 220; k++) {
        const t = k / 220;
        const y = y0 + (y1 - y0) * t;
        const env = Math.sin(Math.PI * t);
        const x = cx
          + worldW * 0.20 * env * Math.sin(2 * Math.PI * t * 3.2 + 0.4)
          + worldW * 0.055 * Math.sin(2 * Math.PI * t * 7.3);
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
