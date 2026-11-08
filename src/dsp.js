/*  GlassHouse — real-time dynamics (runs inside the AudioWorklet)
 *  ------------------------------------------------------------
 *  Each wet mode (n, m) is a degenerate pair (cos n·θ / sin n·θ shapes). A real
 *  glass is never perfectly axisymmetric, so the pair is split by a tiny
 *  fraction about a fixed "defect" axis — this is what makes real glasses beat.
 *
 *  Finger = fingertip pad: mass m_p on a shear spring/damper (skin) whose base
 *  is your fingertip moving round the rim. Pad ↔ glass contact obeys a
 *  velocity-weakening (Stribeck) friction law, solved implicitly every
 *  sub-step: stick if the force needed to keep zero slip is below μs·F_N,
 *  otherwise slip with μ(|v_rel|)·F_N. The glass side of that solve uses the
 *  exact one-step mobility of all modes at the contact point, so stick–slip
 *  locks to the glass resonance on its own — nothing is told what pitch to make.
 *  Skin also damps radial/axial rim motion under the finger (∝ F_N^0.7).
 *  Sound = far-field pressure from each mode's radiated power with its cos(nθ)
 *  directivity, picked up at two virtual mics in front of the glass.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

  const FINGER = {
    wet:  { mu0: 0.60, d: 0.15, eps: 0.05, beta: 0.0, Dc: 2e-6, vAge: 0.002 },
    dry:  { mu0: 0.85, d: 0.03,  eps: 0.001, beta: 0.6, Dc: 2e-6, vAge: 0.002 },
    oily: { mu0: 0.22, d: 0.004, eps: 0.003, beta: 0.0, Dc: 2e-6, vAge: 0.002 },
  };

  // steady-state friction: logarithmic velocity weakening (rate-and-state form) + viscous term
  function muSteady(fr, v) { return Math.max(0.02, fr.mu0 - fr.d * Math.log((v + fr.eps) / 0.1) + fr.beta * v); }

  class GlassVoice {
    constructor(fs, opt) {
      this.fs = fs; this.os = (opt && opt.os) || 2; this.dt = 1 / (fs * this.os);
      this.N = 0; this.cap = 64; this.alloc(this.cap);
      this.keys = []; this.alpha = 0.37; this.split = 3e-4;
      this.Rrim = 0.036;
      // finger
      this.down = false; this.theta = 0; this.thetaT = 0; this.omT = 0; this.omS = 0;
      this.FN = 1.0; this.fr = FINGER.wet; this.mu = 0.7;
      this.mp = 3e-5; this.kp = 1000; this.cp = 1.5;   // fingertip shear impedance (Wiertlewski & Hayward 2012) this.xp = 0; this.vp = 0; this.vb = 0;
      this.cc0 = 3.0; this.rough = 0.01; this.ridge = 4.5e-4; this.ridgePh = 0; this.nz = 0;
      // taps
      this.tapT = -1; this.tapDur = 4e-4; this.tapF = 0; this.tapTh = 0;
      // mics: viewer is at the bottom of the screen (theta = +pi/2), mics +-25 deg
      this.mic = [Math.PI / 2 + 0.44, Math.PI / 2 - 0.44];
      this.gain = 1 / 0.25;                            // 0.25 Pa -> full scale
      this.stickCount = 0; this.stepCount = 0; this.pAcc = 0; this.pN = 0;
      this.seed = 12345;
    }
    alloc(n) {
      const F = () => new Float64Array(n);
      this.q = F(); this.v = F(); this.w2 = F(); this.dc = F(); this.om = F();
      this.nn = new Int32Array(n); this.isB = new Uint8Array(n);
      this.aT = F(); this.aR = F(); this.aA = F(); this.gL = F(); this.gR = F(); this.G = F();
      this.pT = F(); this.pR = F(); this.pA = F(); this.vs = F();
    }
    rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 * 2 - 1; }

    setModes(list, opt) {
      opt = opt || {};
      if (opt.split != null) this.split = opt.split;
      if (opt.alpha != null) this.alpha = opt.alpha;
      if (opt.Rrim) this.Rrim = opt.Rrim;
      const oldIdx = new Map(); this.keys.forEach((k, i) => oldIdx.set(k, i));
      const oq = this.q, ov = this.v;
      const lim = 1.7 / this.dt, need = list.length * 2;
      if (need > this.cap) { this.cap = need; }
      const q = new Float64Array(this.cap), v = new Float64Array(this.cap);
      const keep = this.q; this.alloc(this.cap);
      const keys = []; let k = 0;
      for (const m of list) {
        if (m.omega > lim) continue;
        for (let b = 0; b < 2; b++) {
          const key = m.key + (b ? 'B' : 'A'), j = oldIdx.get(key);
          if (j != null) { q[k] = oq[j]; v[k] = ov[j]; }
          const om = m.omega * (1 + (b ? 0.5 : -0.5) * this.split);
          this.om[k] = om;
          this.w2[k] = Math.pow(2 / this.dt * Math.sin(om * this.dt / 2), 2);  // pre-warped for symplectic Euler
          this.dc[k] = 2 * m.zeta * om;
          this.nn[k] = m.n; this.isB[k] = b;
          this.aT[k] = m.rimV; this.aR[k] = m.rimR; this.aA[k] = m.rimA; this.G[k] = m.G;
          const fL = this.mic[0] - this.alpha, fR = this.mic[1] - this.alpha;
          this.gL[k] = m.G * (b ? Math.sin(m.n * fL) : Math.cos(m.n * fL));
          this.gR[k] = m.G * (b ? Math.sin(m.n * fR) : Math.cos(m.n * fR));
          keys.push(key); k++;
        }
      }
      this.q = q; this.v = v; this.N = k; this.keys = keys;
    }

    setFinger(f) {
      if (f.FN != null) this.FN = f.FN;
      if (f.cond) this.fr = FINGER[f.cond] || FINGER.wet;
      if (f.down != null) {
        if (f.down && !this.down) { this.mu = muSteady(this.fr, 0); this.theta = f.theta; this.thetaT = f.theta; this.omS = 0; this.xp = 0; this.vp = 0; }
        this.down = f.down;
      }
      if (f.theta != null) this.thetaT = f.theta;
      if (f.omega != null) this.omT = f.omega;
    }
    // true when the glass is silent and untouched: skip it entirely (saves CPU with many glasses)
    quiet() {
      if (this.down || this.tapT >= 0) return false;
      let e = 0; for (let k = 0; k < this.N; k++) e += this.G[k] * (Math.abs(this.v[k]) + this.om[k] * Math.abs(this.q[k]));
      if (e < 3e-6) { if (e > 0) { this.q.fill(0); this.v.fill(0); } return true; }
      return false;
    }
    tap(theta, force) { this.tapT = 0; this.tapTh = theta; this.tapF = force || 6; }
    damp() { this.q.fill(0); this.v.fill(0); }

    // shape factors for oscillator k at angle th
    process(outL, outR, len) {
      const dt = this.dt, os = this.os, N = this.N, fr = this.fr;
      const q = this.q, v = this.v, w2 = this.w2, dc = this.dc, nn = this.nn, isB = this.isB;
      const aT = this.aT, aR = this.aR, aA = this.aA, pT = this.pT, pR = this.pR, pA = this.pA, vs = this.vs;
      const cn = new Float64Array(8), snn = new Float64Array(8), tc = new Float64Array(8), ts = new Float64Array(8);
      const aW = 1 - Math.exp(-dt / 0.018);
      for (let i = 0; i < len; i++) {
        let accL = 0, accR = 0;
        for (let o = 0; o < os; o++) {
          // ---- finger kinematics (smoothed velocity, soft position lock)
          if (this.down) {
            this.omS += (this.omT - this.omS) * aW;
            this.thetaT += this.omT * dt;
            this.theta += this.omS * dt + wrap(this.thetaT - this.theta) * 25 * dt;
            this.vb = this.Rrim * this.omS;
          }
          const ph = this.theta - this.alpha, c1 = Math.cos(ph), s1 = Math.sin(ph);
          cn[0] = 1; snn[0] = 0; cn[1] = c1; snn[1] = s1;
          for (let n = 2; n < 8; n++) { cn[n] = cn[n - 1] * c1 - snn[n - 1] * s1; snn[n] = snn[n - 1] * c1 + cn[n - 1] * s1; }
          let tapping = false, Ft = 0;
          if (this.tapT >= 0) {
            const tp = this.tapTh - this.alpha, c = Math.cos(tp), s = Math.sin(tp);
            tc[0] = 1; ts[0] = 0; tc[1] = c; ts[1] = s;
            for (let n = 2; n < 8; n++) { tc[n] = tc[n - 1] * c - ts[n - 1] * s; ts[n] = ts[n - 1] * c + tc[n - 1] * s; }
            Ft = -this.tapF * Math.sin(Math.PI * this.tapT / this.tapDur);          // inward radial push
            tapping = true; this.tapT += dt; if (this.tapT > this.tapDur) this.tapT = -1;
          }
          // ---- contact geometry + explicit forces
          let vr = 0, va = 0, Y = 0;
          for (let k = 0; k < N; k++) {
            const n = nn[k], C = cn[n], S = snn[n];
            if (isB[k]) { pT[k] = -aT[k] * C; pR[k] = aR[k] * S; pA[k] = aA[k] * S; }
            else { pT[k] = aT[k] * S; pR[k] = aR[k] * C; pA[k] = aA[k] * C; }
            vr += pR[k] * v[k]; va += pA[k] * v[k]; Y += pT[k] * pT[k];
          }
          const cc = this.down ? this.cc0 * Math.sqrt(this.FN) : 0;
          const Fr = -cc * vr, Fa = -cc * va;
          let vg = 0;
          for (let k = 0; k < N; k++) {
            let Q = pR[k] * Fr + pA[k] * Fa;
            if (tapping) { const n = nn[k]; Q += Ft * aR[k] * (isB[k] ? ts[n] : tc[n]); }
            const vk = (v[k] + dt * (-w2[k] * q[k] + Q)) / (1 + dc[k] * dt);
            vs[k] = vk; vg += pT[k] * vk;
          }
          // ---- friction (implicit)
          let F = 0;
          if (this.down && this.FN > 0) {
            const mp = this.mp;
            const vpS = (this.vp + dt * (-this.kp * this.xp + this.cp * this.vb) / mp) / (1 + this.cp * dt / mp);
            const vrel = vpS - vg, Z = dt * (1 / mp + Y);
            // fingerprint ridges + skin micro-roughness modulate the friction coefficient
            this.ridgePh += Math.abs(this.vb) * dt / this.ridge;
            this.nz = 0.97 * this.nz + 0.03 * this.rand();
            const mod = 1 + this.rough * (0.6 * Math.sin(TAU * this.ridgePh) + 4 * this.nz);
            const FN = this.FN, muNow = this.mu * mod;
            const Fs = vrel / Z;
            let vAfter;
            if (Math.abs(Fs) <= muNow * FN) { F = Fs; vAfter = 0; this.stickCount++; }
            else { const sg = vrel > 0 ? 1 : -1; F = sg * muNow * FN; vAfter = vrel - Z * F; }
            // rate-and-state friction: the contact's friction level relaxes toward the
            // steady-state Stribeck value over a slip distance Dc (and re-ages while stuck)
            const av = Math.abs(vAfter);
            const muSS = muSteady(fr, av);
            const rate = fr.tau ? 1 / fr.tau : (av + fr.vAge) / fr.Dc;
            this.mu += (muSS - this.mu) * (1 - Math.exp(-dt * rate));
            this.vp = vpS - dt * F / mp;
            this.xp += dt * (this.vp - this.vb);
            this.stepCount++;
          }
          // ---- update modes, radiate
          let pl = 0, pr = 0;
          const gL = this.gL, gR = this.gR;
          for (let k = 0; k < N; k++) {
            const vk = vs[k] + dt * pT[k] * F;
            v[k] = vk; q[k] += dt * vk;
            pl += gL[k] * vk; pr += gR[k] * vk;
          }
          accL += pl; accR += pr;
        }
        const L = accL / os, R = accR / os;
        this.pAcc += 0.5 * (L * L + R * R); this.pN++;
        outL[i] = L * this.gain; outR[i] = R * this.gain;
      }
    }

    // snapshot for visuals: complex amplitude per oscillator
    snapshot() {
      const N = this.N, amps = new Float64Array(N * 2);
      for (let k = 0; k < N; k++) { amps[2 * k] = this.q[k]; amps[2 * k + 1] = this.v[k] / this.om[k]; }
      const prms = Math.sqrt(this.pAcc / Math.max(1, this.pN));
      const stick = this.stepCount ? this.stickCount / this.stepCount : 0;
      this.pAcc = 0; this.pN = 0; this.stickCount = 0; this.stepCount = 0;
      return { keys: this.keys.slice(), amps, theta: this.theta, down: this.down, prms, stick, vb: this.vb, alpha: this.alpha };
    }
  }

  const api = { GlassVoice, FINGER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GlassDSP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
