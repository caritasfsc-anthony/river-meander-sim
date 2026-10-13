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

  function orient(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function onSeg(a, b, p, eps) {
    eps = eps == null ? 1e-6 : eps;
    return p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps
      && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
  }

  /** 線段 ab 與 cd 是否相交；回傳交點參數 {x,y,t,u} 或 null（端點相鄰唔當交差） */
  function segIntersect(a, b, c, d) {
    const o1 = orient(a, b, c), o2 = orient(a, b, d);
    const o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (o1 === 0 && onSeg(a, b, c)) return { x: c.x, y: c.y, t: 0, u: 0 };
    if (o2 === 0 && onSeg(a, b, d)) return { x: d.x, y: d.y, t: 0, u: 0 };
    if (o3 === 0 && onSeg(c, d, a)) return { x: a.x, y: a.y, t: 0, u: 0 };
    if (o4 === 0 && onSeg(c, d, b)) return { x: b.x, y: b.y, t: 0, u: 0 };
    if ((o1 > 0) === (o2 > 0) || (o3 > 0) === (o4 > 0)) return null;
    const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
    if (Math.abs(den) < 1e-12) return null;
    const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
    const u = -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), t, u };
  }

  /** 折線自交：非相鄰線段相交。回傳 [{i,j,pt}, ...]（i < j-1） */
  function findSelfIntersections(pts) {
    const hits = [];
    if (!pts || pts.length < 4) return hits;
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n - 1; j++) {
        if (j === i + 1) continue;
        // 首尾相接唔當自交
        if (i === 0 && j === n - 2) continue;
        const hit = segIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1]);
        if (hit) hits.push({ i, j, pt: { x: hit.x, y: hit.y } });
      }
    }
    return hits;
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
      if (!this.pts.length) return this.baseCoastY - 4;
      const x = this.pts[this.pts.length - 1].x;
      return this.waterLineY(x) - 4;
    }

    get baseWidth() { return 3.2 * Math.sqrt(this.Q); }

    /** 中游參考河寬（受流量＋侵蝕加闊影響） */
    get width() {
      const base = this.baseWidth;
      const ceil = base * 2.6;
      const extra = (ceil - base) * (1 - Math.exp(-this.erosionWiden / (base * 2.2)));
      return base + extra;
    }

    /** 沿程河寬：上游較窄 → 河口明顯加闊（河口喇叭口） */
    widthAt(frac) {
      const mid = this.width;
      const up = mid * 0.72;
      const mouth = mid * 1.35; // 河口略闊，但唔好闊到岸線自疊成結
      const t = Math.max(0, Math.min(1, frac));
      const ease = t * t * (3 - 2 * t);
      return up + (mouth - up) * (0.3 * t + 0.7 * ease);
    }

    /** 局部河寬：受曲率半徑限制，避免河岸多邊形喺急彎自疊 */
    localDrawWidth(frac, curv) {
      let w = this.widthAt(frac);
      const c = Math.abs(curv || 0);
      if (c > 1e-4) {
        const R = 1 / c; // 約略曲率半徑（米）
        w = Math.min(w, Math.max(this.upstreamWidth * 0.6, R * 1.1));
      }
      return w;
    }

    get upstreamWidth() { return this.widthAt(0); }
    get mouthWidth() { return this.widthAt(1); }

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
      this.pts = this.clipChannelToLand(p);
      this.initial = this.pts.map(q => ({ x: q.x, y: q.y }));
      this.sourceAnchor = { x: this.pts[0].x, y: this.pts[0].y };
      this.computeGeom();
      this.resolveSelfIntersections(12);
      this.checkCutoffs(true);
      this.pts = this.clipChannelToLand(this.pts);
      this.computeGeom();
      return true;
    }

    restart() {
      if (!this.initial) return;
      const init = this.initial;
      const anchor = this.sourceAnchor;
      this.reset();
      this.initial = init;
      this.sourceAnchor = anchor || { x: init[0].x, y: init[0].y };
      this.pts = this.clipChannelToLand(resample(init, this.ds));
      this.computeGeom();
    }

    onParamChange() {
      if (this.pts.length >= 2) {
        this.pts = this.clipChannelToLand(resample(this.pts, this.ds));
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
      // 硬規則：唔准遷入海洋
      if (this.isOcean(nx, ny, 5)) {
        ny = this.waterLineY(nx) - 4;
      }
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
      // 高彎曲度時大幅減速，避免未截彎前已打成結
      const sinDamp = Math.min(1, 1.85 / Math.max(1.15, sinNow));
      for (let i = 0; i < n; i++) {
        // 已近海／入海嘅節點唔再遷移
        if (this.isOcean(p[i].x, p[i].y, 15)) {
          np[i] = { x: p[i].x, y: Math.min(p[i].y, this.waterLineY(p[i].x) - 4) };
          continue;
        }
        let taper = 1;
        const frac = i / (n - 1);
        if (frac < 0.06) taper = frac / 0.06;
        else if (frac > 0.92) taper = (1 - frac) / 0.08;
        taper = Math.max(0.05, taper);

        // 局部曲率過大時再減速（防止單彎纏過鄰彎）
        const curvDamp = 1 / (1 + Math.abs(g.cw[i] || 0) * 2.2);
        let d = E * g.R[i] * dt * taper * (0.45 + 0.55 * sinDamp) * curvDamp;
        const lim = 0.16 * ds;
        if (d > lim) d = lim; else if (d < -lim) d = -lim;
        sum += Math.abs(d);

        let mx = -g.nx[i] * d, my = -g.ny[i] * d;
        // 唔好遷入海：若下一步入海就截喺岸邊
        let nx_ = p[i].x + mx, ny_ = p[i].y + my;
        if (this.isOcean(nx_, ny_, 5)) {
          ny_ = this.waterLineY(nx_) - 4;
          mx = 0; my = 0;
        }
        const c = this.softConfine(nx_, ny_, mx, my);
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

      // 河口：鎖在海岸／三角洲水線內側
      const last = n - 1;
      const tipX = p[last].x + (np[last].x - p[last].x) * 0.25;
      const tipY = this.waterLineY(tipX) - 4;
      np[last] = { x: tipX, y: tipY };

      const a = Math.min(0.05, 0.005 * dt);
      const sm = np.map(q => ({ x: q.x, y: q.y }));
      for (let i = 1; i < n - 1; i++) {
        sm[i].x += a * (np[i - 1].x + np[i + 1].x - 2 * np[i].x);
        sm[i].y += a * (np[i - 1].y + np[i + 1].y - 2 * np[i].y);
      }
      // 保持大致由上至下（但仍鎖在水線內側）
      if (sm[0].y > sm[last].y - 100) {
        sm[last].y = Math.min(sm[0].y + 100, this.waterLineY(sm[last].x) - 4);
      }
      sm[last].y = Math.min(sm[last].y, this.waterLineY(sm[last].x) - 4);

      let nxt = resample(sm, ds);
      if (nxt.length > 420) nxt = resample(sm, ds * (nxt.length / 380));
      this.pts = this.clipChannelToLand(nxt);
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
      // 每步：先清自交，再做鄰近曲流頸截彎；活躍河道必須係簡單曲線
      this.resolveSelfIntersections(8);
      this.checkCutoffs(false);
      // 彎曲度過高 → 強制截最大環，保持開放河曲（唔好變意粉）
      let guard = 0;
      while (this.sinuosity() > 2.15 && guard++ < 6) {
        if (!this.forceLargestLoopCutoff()) break;
      }
      this.pts = this.spreadBends(this.clipChannelToLand(this.pts));
      this.resolveSelfIntersections(4);
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
      if (!o || !o.pts || o.pts.length < 4) return false;
      let sea = 0;
      for (const q of o.pts) {
        if (this.isOcean(q.x, q.y, 8)) sea++;
      }
      // 任何明顯入海就丟棄（唔准跨海纏結）
      return sea === 0;
    }

    /** 裁掉伸入海的牛軛湖點：第一個入海點之後全部丟棄 */
    clipOxbowPts(pts) {
      const out = [];
      for (const q of pts) {
        if (this.isOcean(q.x, q.y, 8)) break;
        out.push({ x: q.x, y: q.y });
      }
      return out;
    }

    /**
     * 活躍河道自交數（非相鄰線段相交）。教學上必須為 0。
     */
    countSelfIntersections() {
      return findSelfIntersections(this.pts).length;
    }

    /**
     * 執行一次截彎：丟掉 i..j 環路作牛軛湖，重連成簡單曲線。
     */
    applyCutoff(i, j, opts) {
      opts = opts || {};
      const p = this.pts, W = this.width;
      if (i < 0 || j <= i + 2 || j >= p.length) return false;
      let oxPts = p.slice(i, j + 1).map(q => ({ x: q.x, y: q.y }));
      oxPts = this.clipOxbowPts(oxPts);
      const oxLen = polyLength(oxPts);
      const maxOx = Math.min(this.worldH * 0.35, W * 28);
      // 自交強制截：即使環路較長都保留（截短至 maxOx）
      if (oxPts.length >= 4) {
        if (oxLen > maxOx) {
          // 只留環路中段做成短新月
          const keep = Math.max(6, Math.floor(oxPts.length * (maxOx / oxLen)));
          const mid = Math.floor((oxPts.length - keep) / 2);
          oxPts = oxPts.slice(mid, mid + keep);
        }
        if (this.oxbowOnLand({ pts: oxPts }) || opts.forceOxbow) {
          if (oxPts.length >= 4 && this.oxbowOnLand({ pts: oxPts })) {
            this.oxbows.push({ pts: oxPts, age: 0, width: W * 0.85, year: this.year, closed: true });
          }
        }
      }
      const mid = {
        x: (p[i].x + p[j].x) * 0.5,
        y: (p[i].y + p[j].y) * 0.5
      };
      const np = p.slice(0, i + 1).concat([mid], p.slice(j));
      for (let it = 0; it < 10; it++) {
        for (let k = Math.max(1, i - 4); k <= Math.min(np.length - 2, i + 6); k++) {
          np[k] = {
            x: (np[k - 1].x + 2 * np[k].x + np[k + 1].x) / 4,
            y: (np[k - 1].y + 2 * np[k].y + np[k + 1].y) / 4
          };
        }
      }
      let out = resample(np, this.ds);
      if (out.length > 420) out = resample(np, this.ds * (out.length / 380));
      this.pts = this.clipChannelToLand(out);
      this.cutoffs++;
      this.events.push({ type: 'cutoff', year: this.year, neck: dist(p[i], p[j]), forced: !!opts.forced });
      this.cutoffCooldown = opts.forced ? 4 : 12;
      this.pendingNeck = null;
      this.neckTimer = 0;
      this.computeGeom();
      return true;
    }

    /**
     * 硬規則：活躍中心線唔准自交。發現線段相交就即刻截彎。
     */
    resolveSelfIntersections(maxCuts) {
      maxCuts = maxCuts == null ? 6 : maxCuts;
      let cuts = 0;
      while (cuts < maxCuts) {
        const hits = findSelfIntersections(this.pts);
        if (!hits.length) break;
        // 揀最短環路先截（避免一次切掉大半條河）
        let best = null, bestLen = Infinity;
        for (const h of hits) {
          const loopLen = polyLength(this.pts.slice(h.i, h.j + 2));
          if (loopLen < bestLen) { bestLen = loopLen; best = h; }
        }
        if (!best) break;
        // 交點附近節點：用 i+1 同 j 做頸
        const i = best.i + 1;
        const j = best.j;
        if (j - i < 3) {
          // 極短自交：直接刪中間點
          const np = this.pts.slice(0, best.i + 1).concat(this.pts.slice(best.j + 1));
          this.pts = this.clipChannelToLand(resample(np, this.ds));
          this.cutoffs++;
          this.computeGeom();
        } else {
          this.applyCutoff(i, j, { forced: true, forceOxbow: true });
        }
        cuts++;
      }
      return cuts;
    }

    /**
     * 輕推過近嘅非相鄰彎，令彎曲沿下游展開，唔好全部堆喺河口。
     */
    spreadBends(pts) {
      if (!pts || pts.length < 8) return pts;
      const out = pts.map(q => ({ x: q.x, y: q.y }));
      const W = this.width;
      const minSep = W * 1.6;
      const minAlong = Math.max(4, Math.ceil((3.5 * W) / this.ds));
      for (let i = 2; i < out.length - 2; i++) {
        for (let j = i + minAlong; j < out.length - 1; j++) {
          const d = dist(out[i], out[j]);
          if (d >= minSep || d < 1e-6) continue;
          // 太近但未到截彎閾值：輕輕推開
          const push = (minSep - d) * 0.12;
          const ux = (out[j].x - out[i].x) / d;
          const uy = (out[j].y - out[i].y) / d;
          out[i].x -= ux * push * 0.5;
          out[i].y -= uy * push * 0.5;
          out[j].x += ux * push * 0.5;
          out[j].y += uy * push * 0.5;
        }
      }
      return out;
    }

    /**
     * 當彎曲度過高：搵「頸最窄／環最明顯」嘅非相鄰對強制截彎。
     */
    forceLargestLoopCutoff() {
      const p = this.pts, n = p.length, W = this.width;
      if (n < 16) return false;
      const minAlong = Math.max(5, Math.ceil((3.0 * W) / this.ds));
      const margin = Math.max(3, Math.ceil(n * 0.04));
      // 預計算弧長，避免每對都 polyLength
      const S = new Float64Array(n);
      for (let i = 1; i < n; i++) S[i] = S[i - 1] + dist(p[i - 1], p[i]);
      let best = null, bestScore = -1;
      for (let i = margin; i < n - margin; i++) {
        for (let j = i + minAlong; j < n - margin; j++) {
          const d = dist(p[i], p[j]);
          if (d > W * 4.5) continue;
          const loopLen = S[j] - S[i];
          if (loopLen < W * 5) continue;
          if (loopLen > this.worldH * 0.45) continue;
          const loopSin = loopLen / (d || 1);
          if (loopSin < 1.7) continue;
          const score = loopSin / (d / W + 0.25);
          if (score > bestScore) { bestScore = score; best = [i, j]; }
        }
      }
      if (!best) return false;
      return this.applyCutoff(best[0], best[1], { forced: true });
    }

    /**
     * 截彎取直：非相鄰節點接近至 ~1.0–1.5× 河寬就截；
     * 自交已由 resolveSelfIntersections 處理。
     */
    checkCutoffs(immediate) {
      // 自交唔受 cooldown 限制
      this.resolveSelfIntersections(immediate ? 12 : 4);
      if (!immediate && this.cutoffCooldown > 0) return;
      const p = this.pts, n = p.length, W = this.width;
      if (n < 12) return;

      const thr = W * (immediate ? 1.5 : 1.25);
      const minAlong = Math.max(6, Math.ceil((4.0 * W) / this.ds));
      const marginNodes = Math.max(3, Math.ceil(n * 0.04));

      const cell = Math.max(thr, 16), grid = new Map();
      const key = (cx, cy) => cx * 100003 + cy;
      for (let i = marginNodes; i < n - marginNodes; i++) {
        const k = key(Math.floor(p[i].x / cell), Math.floor(p[i].y / cell));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }

      let best = null, bestScore = -1;
      for (let i = marginNodes; i < n - marginNodes; i++) {
        if (p[i].y > this.waterLineY(p[i].x) - 80) continue;
        const cx = Math.floor(p[i].x / cell), cy = Math.floor(p[i].y / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const list = grid.get(key(cx + ox, cy + oy));
          if (!list) continue;
          for (const j of list) {
            if (j - i < minAlong || j >= n - marginNodes) continue;
            if (p[j].y > this.waterLineY(p[j].x) - 80) continue;
            const d = dist(p[i], p[j]);
            if (d >= thr) continue;
            const loopPts = p.slice(i, j + 1);
            const loopLen = polyLength(loopPts);
            const loopSin = loopLen / (d || 1);
            // 成熟彎：路徑明顯長過頸距；拒絕半個地圖嘅超長結（自交已另處理）
            if (loopSin < (immediate ? 1.6 : 1.8)) continue;
            if (loopLen > Math.min(this.worldH * 0.32, W * 26)) continue;
            const score = (1 / (d / W + 0.15)) * Math.min(loopSin, 4.5);
            if (score > bestScore) { bestScore = score; best = [i, j, d, loopSin]; }
          }
        }
      }

      if (!best) { this.pendingNeck = null; this.neckTimer = 0; return; }
      const [i, j] = best;
      this.applyCutoff(i, j, { forced: !!immediate });
      // 可能仲有第二個頸：短 cooldown 後下一步再截
    }

    /** 點是否已入海／到達水線（含緊貼海岸） */
    isOcean(x, y, margin) {
      margin = margin == null ? 2 : margin;
      return y >= this.waterLineY(x) - margin;
    }

    /**
     * 水線：三角洲只在河口附近凸出；遠離河口嘅位置用原始海岸，
     * 避免河道喺三角洲側翼被當成「陸地」而喺視覺上海面蜿蜒／折返。
     */
    waterLineY(x) {
      const base = this.baseCoastY;
      if (!this.pts.length || this.deltaAdvance < 1) return base;
      const mx = this.pts[this.pts.length - 1].x;
      const hw = Math.max(40, this.deltaHalfW * 0.85);
      const u = Math.abs(x - mx) / hw;
      if (u >= 1) return base;
      // 只喺河口扇形內允許三角洲前進
      const lobe = Math.exp(-u * u * 2.2);
      return base + this.deltaAdvance * 0.82 * lobe;
    }

    /**
     * 硬規則：由上游往下走，第一個碰到海岸／海洋嘅點即為河口。
     * 之後全部丟棄——唔准繼續、唔准喺水面蜿蜒、唔准折返陸地。
     */
    truncateAtCoast(pts) {
      if (!pts || pts.length < 2) return pts ? pts.slice() : [];
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const q = { x: pts[i].x, y: pts[i].y };
        if (this.isOcean(q.x, q.y, 5)) {
          const cy = this.waterLineY(q.x);
          out.push({ x: q.x, y: cy - 4 });
          break;
        }
        out.push(q);
      }
      if (out.length < 2) {
        // 保底：至少保留源到海岸
        const a = pts[0];
        const cy = this.coastY(a.x);
        return [ { x: a.x, y: a.y }, { x: a.x, y: Math.min(cy - 1, a.y + 100) } ];
      }
      // 河口對齊水線內側
      const last = out[out.length - 1];
      last.y = Math.min(last.y, this.waterLineY(last.x) - 4);
      return out;
    }

    /** @deprecated 用 truncateAtCoast */
    clipChannelToLand(pts) {
      return this.enforceSeawardNearCoast(this.truncateAtCoast(pts));
    }

    /**
     * 近岸河段只准向海（y 增加），禁止大迴環向北折返（睇落似由海爬返陸地）。
     */
    enforceSeawardNearCoast(pts) {
      if (!pts || pts.length < 3) return pts;
      const out = pts.map(q => ({ x: q.x, y: q.y }));
      let i0 = -1;
      for (let i = 0; i < out.length; i++) {
        if (out[i].y >= this.waterLineY(out[i].x) - 220) { i0 = i; break; }
      }
      if (i0 < 0) return out;
      let floorY = out[i0].y;
      for (let i = i0 + 1; i < out.length; i++) {
        // 允許輕微上下，但唔好大幅向北
        if (out[i].y < floorY - 35) {
          // 截斷：近岸折返即視為到達河口
          out[i].y = Math.min(floorY, this.waterLineY(out[i].x) - 4);
          return this.truncateAtCoast(out.slice(0, i + 1));
        }
        floorY = Math.max(floorY, out[i].y - 10);
      }
      return out;
    }

    /** 繪圖／粒子用：活躍陸上河道（已截斷，唔會入海） */
    landChannel() {
      const p = this.pts;
      if (p.length < 2) return [];
      // pts 應已截斷；再防禦一次
      const clipped = this.truncateAtCoast(p);
      return clipped.map((q, i) => ({ x: q.x, y: q.y, i: Math.min(i, p.length - 1) }));
    }

    /** 回歸測試：活躍河道唔准有入海點（河口可貼水線） */
    countOceanPoints(margin) {
      margin = margin == null ? 5 : margin;
      let n = 0;
      for (let i = 0; i < this.pts.length; i++) {
        const p = this.pts[i];
        // 河口允許貼在水線內側 6m 內
        const lim = this.waterLineY(p.x) - (i === this.pts.length - 1 ? 0 : margin);
        if (p.y > lim) n++;
      }
      return n;
    }

    /**
     * 回歸：一旦有點貼近／到達海岸，其後唔准再有點明顯向北折返（入海後爬返陸地）。
     * 正常截斷後唔應該發生。
     */
    hasSeaUTurn() {
      const p = this.pts;
      if (p.length < 4) return false;
      let touchIdx = -1, touchY = 0;
      for (let i = 0; i < p.length; i++) {
        if (p[i].y >= this.waterLineY(p[i].x) - 12) { touchIdx = i; touchY = p[i].y; break; }
      }
      if (touchIdx < 0) return false;
      for (let i = touchIdx + 1; i < p.length; i++) {
        if (p[i].y < touchY - 60) return true;
      }
      // 另外：唔准有「入海點」之後仲有陸上點
      let seenSea = false;
      for (let i = 0; i < p.length; i++) {
        if (this.isOcean(p[i].x, p[i].y, 5)) seenSea = true;
        else if (seenSea) return true;
      }
      return false;
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
      if (this.deltaAdvance < 20 || this.pts.length < 2) return [];
      const mouth = this.pts[this.pts.length - 1];
      const adv = this.deltaAdvance;
      const hw = this.deltaHalfW;
      const arms = [];
      const angles = [-0.5, 0.0, 0.5];
      const nArms = adv > 80 ? 3 : 2;
      for (let a = 0; a < nArms; a++) {
        const ang = angles[a];
        const len = Math.min(adv * 0.7, adv - 5) * (a === 1 ? 1.0 : 0.75);
        const tipX = mouth.x + Math.sin(ang) * hw * 0.5;
        let tipY = mouth.y + Math.max(12, len * 0.55);
        // 尖端停在海岸線附近，唔伸入遠海
        tipY = Math.min(tipY, this.coastY(tipX) + 4);
        const mid = {
          x: mouth.x + Math.sin(ang) * hw * 0.22,
          y: mouth.y + (tipY - mouth.y) * 0.45
        };
        arms.push([{ x: mouth.x, y: mouth.y }, mid, { x: tipX, y: tipY }]);
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
          + worldW * 0.14 * env * Math.sin(2 * Math.PI * t * 2.6 + 0.35)
          + worldW * 0.035 * Math.sin(2 * Math.PI * t * 5.5);
        pts.push({ x, y });
      }
      return pts;
    }
  }

  RiverSim.resample = resample;
  RiverSim.chaikin = chaikin;
  RiverSim.polyLength = polyLength;
  RiverSim.findSelfIntersections = findSelfIntersections;
  RiverSim.segIntersect = segIntersect;

  if (typeof module !== 'undefined' && module.exports) module.exports = RiverSim;
  else root.RiverSim = RiverSim;
})(typeof window !== 'undefined' ? window : this);
