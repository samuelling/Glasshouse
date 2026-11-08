(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12), ftom = f => 69 + 12 * Math.log2(f / 440);
  const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const nn = m => NOTES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  const ALPHA = 0.37, EXAG = 30, OUT_PA = 1.2, NTH = 120;
  const SCALES = {
    majorPent: { name: 'Major pentatonic', s: [0, 2, 4, 7, 9] }, major: { name: 'Major', s: [0, 2, 4, 5, 7, 9, 11] },
    minorPent: { name: 'Minor pentatonic', s: [0, 3, 5, 7, 10] }, minor: { name: 'Natural minor', s: [0, 2, 3, 5, 7, 8, 10] },
    wholeTone: { name: 'Whole tone', s: [0, 2, 4, 6, 8, 10] }, chromatic: { name: 'Chromatic', s: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  };
  const SHAPES = { bordeaux: 'Bordeaux', burgundy: 'Burgundy balloon', tulip: 'Tulip (flared rim)', snifter: 'Brandy snifter', flute: 'Champagne flute' };
  const MATERIALS = { leadCrystal: 'Lead crystal', sodaLime: 'Soda-lime glass', borosilicate: 'Borosilicate', fusedQuartz: 'Fused quartz' };
  const S = { count: 6, root: 72, scale: 'majorPent', material: 'leadCrystal', tRim: 1.2e-3, FN: 1.0, cond: 'wet', reverb: 0.3, vol: 0.8, autorub: false };

  // ------------------------------------------------------------ physics service (Web Worker)
  const physSrc = $('phys-src').textContent;
  const svc = (() => {
    let worker = null, local = null, n = 0; const pending = new Map();
    const useLocal = () => {
      if (!local) { if (!window.GlassPhysics) (new Function(physSrc))(); local = window.GlassPhysics.makeService(); }
      worker = null; for (const [req, p] of pending) { pending.delete(req); setTimeout(() => p.res(local.handle(p.m)), 0); }
    };
    try {
      const code = physSrc + '\nconst S = GlassPhysics.makeService(); onmessage = e => { const m = e.data; let r; try { r = S.handle(m); } catch (err) { r = { id: m.id, error: String(err) }; } r.req = m.req; postMessage(r); };';
      worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
      worker.onmessage = e => { const p = pending.get(e.data.req); if (p) { pending.delete(e.data.req); p.res(e.data); } };
      worker.onerror = e => { console.warn('physics worker failed; running on main thread', e.message); useLocal(); };
    } catch (e) { console.warn('no worker', e); }
    return {
      call(m) {
        return new Promise(res => {
          m.req = ++n;
          if (worker) { pending.set(m.req, { res, m }); worker.postMessage(m); }
          else { if (!local) useLocal(); setTimeout(() => res(local.handle(m)), 0); }
        });
      },
    };
  })();

  // ------------------------------------------------------------ glasses
  let glasses = [];
  function newGlass(i) { return { id: i, shape: 'bordeaux', scale: 1, fill: 0, midi: 72, info: null, modes: [], f: NaN, waterR: 0, waterRD: 0, inRange: true, held: null, touch: null, lastUse: 0, seq: 0, modeByKey: new Map(), snap: null, keyRub: false, glow: 0 }; }
  let busyN = 0;
  function busy(d, msg) { busyN += d; $('busy').classList.toggle('on', busyN > 0); if (msg) $('busyMsg').textContent = msg; }
  function applyWet(g, r) {
    if (r.error) { console.warn(r.error); return; }
    if (r.info) g.info = r.info, g.scale = r.info.scale;
    if (r.inRange != null) g.inRange = r.inRange;
    const w = r.wet; g.fill = w.fill; g.modes = w.modes; g.f = w.f; g.waterR = w.waterR; g.volume = w.volume;
    g.modeByKey = new Map(w.modes.map(m => [m.key, m]));
    sendModes(g); layoutKeys(); if (g === edG) refreshEditor();
  }
  async function fit(g) {
    const seq = ++g.seq; busy(1, 'Sizing glasses & pouring…');
    const r = await svc.call({ cmd: 'fit', id: g.id, hz: mtof(g.midi), cfg: { shape: g.shape, material: S.material, tRim: S.tRim } });
    busy(-1); if (seq === g.seq) applyWet(g, r);
  }
  async function rebuild(g) {
    const seq = ++g.seq; busy(1, 'Solving shell…');
    const r = await svc.call({ cmd: 'build', id: g.id, fill: g.fill, cfg: { shape: g.shape, material: S.material, tRim: S.tRim, scale: g.scale } });
    busy(-1); if (seq === g.seq) applyWet(g, r);
  }
  async function pourTo(g, hz) {               // keep size, change water only
    if (!g.info) return;
    const seq = ++g.seq;
    const r = await svc.call({ cmd: 'tune', id: g.id, hz });
    if (seq === g.seq) applyWet(g, r);
  }
  async function setFillManual(g, fill) {
    const seq = ++g.seq;
    const r = await svc.call({ cmd: 'fill', id: g.id, fill });
    if (seq === g.seq) { applyWet(g, r); g.midi = Math.round(ftom(g.f)); }
  }
  function scaleNotes(root, sc, count) {
    const s = SCALES[sc].s, out = [];
    for (let i = 0; out.length < count; i++) out.push(root + 12 * Math.floor(i / s.length) + s[i % s.length]);
    return out;
  }
  async function tuneToScale() {
    const notes = scaleNotes(S.root, S.scale, glasses.length);
    glasses.forEach((g, i) => { g.midi = notes[i]; });
    for (const g of glasses) await fit(g);
  }
  async function spreadForKeys() {
    glasses.forEach((g, i) => { g.midi = Math.max(48, Math.min(96, S.root - 12 + 7 * i)); });
    for (const g of glasses) await fit(g);
  }
  function setCount(n) {
    S.count = n;
    for (const g of glasses) if (g.touch != null || g.held != null) { send({ t: 'finger', i: g.id, f: { down: false } }); }
    glasses = Array.from({ length: n }, (_, i) => glasses[i] || newGlass(i));
    send({ t: 'count', n });
    glasses.forEach(g => send({ t: 'pan', i: g.id, p: 0 }));
    layout();
    tuneToScale();
  }

  // ------------------------------------------------------------ audio
  let audio = null;
  const BANK = `
class GlassBank extends AudioWorkletProcessor {
  constructor() { super(); this.voices = []; this.pan = []; this.g = 1; this.k = 0; this.tL = new Float32Array(128); this.tR = new Float32Array(128);
    this.port.onmessage = e => { const m = e.data;
      if (m.t === 'count') { while (this.voices.length < m.n) { const v = new globalThis.GlassDSP.GlassVoice(sampleRate, { os: 2 }); v.gain = this.g; this.voices.push(v); this.pan.push(0); } this.voices.length = m.n; this.pan.length = m.n; return; }
      if (m.t === 'gain') { this.g = m.g; for (const v of this.voices) v.gain = m.g; return; }
      const v = this.voices[m.i]; if (!v) return;
      if (m.t === 'modes') v.setModes(m.modes, m.opt); else if (m.t === 'finger') v.setFinger(m.f); else if (m.t === 'tap') v.tap(m.theta, m.force); else if (m.t === 'pan') this.pan[m.i] = m.p; }; }
  process(inp, out) {
    const o = out[0], L = o[0], R = o[1] || o[0], n = L.length; L.fill(0); if (R !== L) R.fill(0);
    if (this.tL.length !== n) { this.tL = new Float32Array(n); this.tR = new Float32Array(n); }
    for (let i = 0; i < this.voices.length; i++) { const v = this.voices[i]; if (v.quiet()) continue;
      v.process(this.tL, this.tR, n); const a = (this.pan[i] + 1) * Math.PI / 4, gl = Math.cos(a) * 1.4142, gr = Math.sin(a) * 1.4142;
      for (let k = 0; k < n; k++) { L[k] += this.tL[k] * gl; R[k] += this.tR[k] * gr; } }
    if (++this.k % 5 === 0) this.port.postMessage(this.voices.map(v => v.snapshot()));
    return true; }
}
registerProcessor('glass-bank', GlassBank);`;
  function send(m) { if (audio) audio.send(m); }
  function sendModes(g) { if (g.modes.length) send({ t: 'modes', i: g.id, modes: g.modes, opt: { split: 3e-4, alpha: ALPHA, Rrim: g.info ? g.info.rimR : 0.036 } }); }
  function makeIR(ctx, secs) {
    const sr = ctx.sampleRate, n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) { const t = i / sr, k = Math.min(0.92, 0.2 + t * 0.9); lp = lp * k + (Math.random() * 2 - 1) * (1 - k); d[i] = lp * Math.exp(-6.9 * t / secs) * (t < 0.012 ? 0 : 1) * 2.2; }
      for (const [dt, a] of [[0.013, 0.5], [0.021, 0.35], [0.034, 0.25], [0.047, 0.2]]) { const j = Math.floor((dt + c * 0.003) * sr); if (j < n) d[j] += a; } }
    return b;
  }
  async function startAudio() {
    if (audio) { if (audio.ctx.state !== 'running') audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC({ latencyHint: 'interactive' });
    const queue = []; audio = { ctx, send: m => queue.push(m) }; ctx.resume();
    const src = $('dsp-src').textContent;
    const master = ctx.createGain(), comp = ctx.createDynamicsCompressor(), dry = ctx.createGain(), wetG = ctx.createGain(), conv = ctx.createConvolver();
    comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 10; comp.attack.value = 0.002; comp.release.value = 0.2;
    conv.buffer = makeIR(ctx, 2.4);
    dry.connect(comp); conv.connect(wetG); wetG.connect(comp); comp.connect(master); master.connect(ctx.destination);
    Object.assign(audio, { master, dry, wetG });
    let node;
    try {
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src + '\n' + BANK], { type: 'application/javascript' })));
      node = new AudioWorkletNode(ctx, 'glass-bank', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = e => onSnap(e.data);
      audio.send = m => node.port.postMessage(m);
    } catch (err) {
      console.warn('AudioWorklet unavailable, using ScriptProcessor', err);
      if (!window.GlassDSP) (new Function(src))();
      const voices = [], pan = []; let g = 1;
      node = ctx.createScriptProcessor(512, 0, 2);
      const tL = new Float32Array(512), tR = new Float32Array(512);
      node.onaudioprocess = e => {
        const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1); L.fill(0); R.fill(0);
        voices.forEach((v, i) => { if (v.quiet()) return; v.process(tL, tR, 512); const a = (pan[i] + 1) * Math.PI / 4; for (let k = 0; k < 512; k++) { L[k] += tL[k] * Math.cos(a) * 1.414; R[k] += tR[k] * Math.sin(a) * 1.414; } });
        onSnap(voices.map(v => v.snapshot()));
      };
      audio.send = m => {
        if (m.t === 'count') { while (voices.length < m.n) { const v = new window.GlassDSP.GlassVoice(ctx.sampleRate, { os: 2 }); v.gain = g; voices.push(v); pan.push(0); } voices.length = m.n; pan.length = m.n; return; }
        if (m.t === 'gain') { g = m.g; voices.forEach(v => v.gain = g); return; }
        const v = voices[m.i]; if (!v) return;
        if (m.t === 'modes') v.setModes(m.modes, m.opt); else if (m.t === 'finger') v.setFinger(m.f); else if (m.t === 'tap') v.tap(m.theta, m.force); else if (m.t === 'pan') pan[m.i] = m.p;
      };
    }
    node.connect(dry); node.connect(conv);
    applyMix();
    send({ t: 'count', n: glasses.length }); send({ t: 'gain', g: 1 / OUT_PA });
    glasses.forEach(g => { send({ t: 'finger', i: g.id, f: { FN: S.FN, cond: S.cond } }); sendModes(g); });
    layout();
    for (const m of queue) if (m.t !== 'count' && m.t !== 'gain') audio.send(m);
  }
  function applyMix() {
    if (!audio || !audio.master) return; const t = audio.ctx.currentTime;
    audio.master.gain.setTargetAtTime(S.vol * S.vol * 1.4, t, 0.03);
    audio.dry.gain.setTargetAtTime(1 - 0.55 * S.reverb, t, 0.03);
    audio.wetG.gain.setTargetAtTime(0.9 * S.reverb, t, 0.03);
  }
  function onSnap(arr) { arr.forEach((s, i) => { if (glasses[i]) glasses[i].snap = s; }); }

  // ------------------------------------------------------------ layout + drawing
  const stage = $('stage'), sc = stage.getContext('2d');
  let W = 0, H = 0, dpr = 1, pxPerM = 1000;
  function resize() {
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    for (const cv of [stage, $('keys')]) { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const r = stage.getBoundingClientRect(); W = r.width; H = r.height; layout(); layoutKeys();
  }
  new ResizeObserver(resize).observe(document.body);
  function layout() {
    const N = glasses.length; if (!N || !W) return;
    let best = null;
    for (let c = 1; c <= N; c++) { const rows = Math.ceil(N / c), cw = W / c, ch = H / rows, s = Math.min(cw, ch / 1.12); if (!best || s > best.s) best = { c, rows, cw, ch, s }; }
    const { c, rows, cw, ch } = best;
    const labH = 50;
    let maxR = 0; for (const g of glasses) if (g.info) maxR = Math.max(maxR, g.info.rMax, g.info.rimR * 1.12);
    const allow = Math.min(cw * 0.44, (ch - labH) * 0.47);
    if (maxR) pxPerM = allow / maxR;
    glasses.forEach((g, i) => {
      const row = Math.floor(i / c), inRow = Math.min(c, N - row * c), col = i - row * c;
      const x0 = (W - inRow * cw) / 2 + col * cw;
      g.cx = x0 + cw / 2; g.cy = row * ch + (ch - labH) * 0.5 + (H - rows * ch) / 2; g.cellH = ch; g.cellW = cw;
      g.R = g.info ? g.info.rimR * pxPerM : allow * 0.8;
      g.labelY = g.cy + (g.info ? Math.max(g.info.rMax, g.info.rimR) * pxPerM : allow) + Math.max(22, Math.min(34, cw * 0.09));
      const p = W > 0 ? ((g.cx / W) * 2 - 1) * 0.75 : 0;
      if (g.pan !== p) { g.pan = p; send({ t: 'pan', i: g.id, p }); }
    });
  }
  const envR = new Float64Array(NTH), dispR = new Float64Array(NTH), envW = new Float64Array(NTH);
  let strobe = 0;
  function analyse(g) {
    envR.fill(0); dispR.fill(0); envW.fill(0);
    const s = g.snap; let rimMax = 0, prms = 0;
    if (!s || !s.keys) return { rimMax, prms };
    prms = s.prms || 0;
    const pairs = new Map();
    for (let k = 0; k < s.keys.length; k++) {
      const key = s.keys[k], base = key.slice(0, -1), m = g.modeByKey.get(base); if (!m) continue;
      let p = pairs.get(base); if (!p) { p = { m, a: [0, 0], b: [0, 0] }; pairs.set(base, p); }
      const z = [s.amps[2 * k], s.amps[2 * k + 1]]; if (key.endsWith('B')) p.b = z; else p.a = z;
    }
    const cs = Math.cos(strobe), sn = Math.sin(strobe);
    for (const { m, a, b } of pairs.values()) {
      if (Math.hypot(a[0], a[1], b[0], b[1]) * Math.abs(m.rimR) < 2e-8) continue;
      for (let i = 0; i < NTH; i++) {
        const th = TAU * i / NTH - ALPHA, c = Math.cos(m.n * th), s2 = Math.sin(m.n * th);
        const re = a[0] * c + b[0] * s2, im = a[1] * c + b[1] * s2;
        const xr = m.rimR * re, xi = m.rimR * im; envR[i] += xr * xr + xi * xi; dispR[i] += xr * cs - xi * sn;
        const wr = m.wl * re, wi = m.wl * im; envW[i] += wr * wr + wi * wi;
      }
    }
    for (let i = 0; i < NTH; i++) { envR[i] = Math.sqrt(envR[i]); envW[i] = Math.sqrt(envW[i]); rimMax = Math.max(rimMax, envR[i]); }
    return { rimMax, prms };
  }
  function drawGlass(g, now, dt) {
    const c = sc, R = g.R, cx = g.cx, cy = g.cy, an = analyse(g);
    const tr = g.info ? Math.max(1.5, g.info.rimT * pxPerM) : 2;
    g.glow += (Math.min(1, Math.max(0, (20 * Math.log10(Math.max(1e-7, an.prms) / 2e-5) - 40) / 35)) - g.glow) * Math.min(1, dt * 8);
    // selection / playing glow
    if (g.glow > 0.02) { const gg = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.6); gg.addColorStop(0, `rgba(159,211,255,${0.18 * g.glow})`); gg.addColorStop(1, 'rgba(159,211,255,0)'); c.fillStyle = gg; c.beginPath(); c.arc(cx, cy, R * 1.6, 0, TAU); c.fill(); }
    const sh = c.createRadialGradient(cx + 6, cy + 10, R * 0.2, cx + 6, cy + 10, R * 1.4); sh.addColorStop(0, 'rgba(0,0,0,.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sh; c.beginPath(); c.arc(cx + 6, cy + 10, R * 1.4, 0, TAU); c.fill();
    if (g.info) {
      const bR = g.info.rMax * pxPerM;
      if (bR > R + 2) { c.strokeStyle = 'rgba(220,235,255,.18)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, bR, 0, TAU); c.stroke(); }
      const fR = 0.039 * g.scale * pxPerM; c.strokeStyle = 'rgba(200,220,245,.07)'; c.beginPath(); c.arc(cx, cy, fR, 0, TAU); c.stroke();
    }
    const ig = c.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R);
    ig.addColorStop(0, 'rgba(230,240,255,.07)'); ig.addColorStop(1, 'rgba(200,220,255,.11)');
    c.fillStyle = ig; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    // water (animated pour)
    g.waterRD += ((g.fill > 0.003 ? g.waterR : 0) * pxPerM - g.waterRD) * Math.min(1, dt * 10);
    const wR = g.waterRD;
    if (wR > 1) {
      const wg = c.createRadialGradient(cx - wR * 0.25, cy - wR * 0.3, wR * 0.1, cx, cy, wR);
      wg.addColorStop(0, 'rgba(90,180,230,.30)'); wg.addColorStop(0.8, 'rgba(40,120,180,.30)'); wg.addColorStop(1, 'rgba(120,200,240,.55)');
      c.fillStyle = wg; c.beginPath(); c.arc(cx, cy, wR, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(170,225,255,.55)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, wR - 0.5, 0, TAU); c.stroke();
      // ripples near antinodes
      const t = now / 1000, lam = Math.max(2, 0.0016 * pxPerM);
      for (let s = 0; s < NTH; s += 2) {
        const st = Math.min(1, envW[s] / 6e-6); if (st < 0.04) continue;
        const th0 = TAU * s / NTH, th1 = TAU * (s + 2) / NTH;
        for (let k = 0; k < 6; k++) { const r = wR - 1.5 - k * lam; if (r < 3) break;
          c.strokeStyle = `rgba(200,240,255,${0.4 * st * Math.exp(-k / (1.4 + 3 * st)) * (0.55 + 0.45 * Math.sin(TAU * (t * 9 - k * 0.5) + s * 0.35))})`;
          c.beginPath(); c.arc(cx, cy, r, th0, th1); c.stroke(); }
      }
    }
    // envelope + rim
    const X = EXAG * pxPerM, lim = 0.16 * R;
    if (an.rimMax * X > 0.3) {
      c.fillStyle = 'rgba(159,211,255,.13)'; c.beginPath();
      for (let i = 0; i <= NTH; i++) { const k = i % NTH, th = TAU * k / NTH, r = R + tr / 2 + lim * Math.tanh(envR[k] * X / lim); i ? c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th)) : c.moveTo(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
      for (let i = NTH; i >= 0; i--) { const k = i % NTH, th = TAU * k / NTH, r = R - tr / 2 - lim * Math.tanh(envR[k] * X / lim); i === NTH ? c.moveTo(cx + r * Math.cos(th), cy + r * Math.sin(th)) : c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
      c.fill('evenodd');
    }
    c.beginPath();
    for (let i = 0; i <= NTH; i++) { const k = i % NTH, th = TAU * k / NTH, r = R + lim * Math.tanh(dispR[k] * X / lim); i ? c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th)) : c.moveTo(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(225,238,255,.2)'; c.lineWidth = Math.max(3, tr * 1.6); c.stroke();
    c.strokeStyle = g === edG ? 'rgba(242,195,139,.95)' : 'rgba(240,248,255,.85)'; c.lineWidth = Math.max(1.3, tr * 0.7); c.stroke();
    // finger (touch or virtual armonica finger)
    if (g.snap && g.snap.down) {
      const fd = g.snap.theta, fx = cx + R * Math.cos(fd), fy = cy + R * Math.sin(fd), fr = Math.max(12, 0.0075 * pxPerM);
      const fg = c.createRadialGradient(fx - fr * 0.3, fy - fr * 0.3, fr * 0.1, fx, fy, fr);
      fg.addColorStop(0, g.touch != null ? 'rgba(246,214,190,.55)' : 'rgba(190,220,250,.45)'); fg.addColorStop(1, g.touch != null ? 'rgba(220,170,140,.22)' : 'rgba(140,180,230,.18)');
      c.fillStyle = fg; c.beginPath(); c.arc(fx, fy, fr, 0, TAU); c.fill();
    }
    // label
    const ly = g.labelY;
    c.textAlign = 'center';
    c.fillStyle = g.held != null ? '#9fd3ff' : '#e8edf3';
    c.font = `300 ${Math.max(18, Math.min(30, g.cellW * 0.09))}px Fraunces, Georgia, serif`;
    c.fillText(isFinite(g.f) ? nn(ftom(g.f)) : '…', cx, ly);
    c.font = '11px "IBM Plex Mono", monospace';
    if (isFinite(g.f)) {
      const cents = Math.round((ftom(g.f) - Math.round(ftom(g.f))) * 100);
      c.fillStyle = g.inRange ? '#8794a6' : '#f2c38b';
      c.fillText(`${g.f.toFixed(1)} Hz ${cents >= 0 ? '+' : '−'}${Math.abs(cents)}¢ · ${Math.round(g.fill * 100)}%${g.inRange ? '' : ' · out of range'}`, cx, ly + 16);
    }
    g.labelBox = { x: cx - g.cellW * 0.4, y: ly - 30, w: g.cellW * 0.8, h: 52 };
  }

  // ------------------------------------------------------------ stage touch (multi-touch)
  const touches = new Map();
  let started = false;
  function hit(x, y) {
    for (const g of glasses) {
      const d = Math.hypot(x - g.cx, y - g.cy), tol = Math.max(0.22 * g.R, 22);
      if (d <= g.R + tol) return { g, d, inner: d < g.R - tol, th: Math.atan2(y - g.cy, x - g.cx) };
      const b = g.labelBox; if (b && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return { g, label: true };
    }
    return null;
  }
  function pos(e, el) { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  stage.addEventListener('pointerdown', e => {
    e.preventDefault(); startAudio();
    if (!started) { started = true; $('hint').classList.add('gone'); }
    const p = pos(e, stage), h = hit(p.x, p.y); if (!h) return;
    if (h.label) { openEditor(h.g); return; }
    const g = h.g;
    if (h.inner) { send({ t: 'tap', i: g.id, theta: h.th, force: 4 + 6 * Math.min(1, h.d / g.R) }); return; }
    if (g.touch != null) return;
    stage.setPointerCapture(e.pointerId);
    g.touch = e.pointerId; g.lastUse = performance.now();
    touches.set(e.pointerId, { g, lastTh: h.th, theta: h.th, lastT: e.timeStamp, omega: 0 });
    send({ t: 'finger', i: g.id, f: { down: true, theta: h.th, omega: 0, FN: S.FN, cond: S.cond } });
  }, { passive: false });
  stage.addEventListener('pointermove', e => {
    const T = touches.get(e.pointerId); if (!T) return;
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null; if (!evs || !evs.length) evs = [e];
    for (const ev of evs) {
      const p = pos(ev, stage), th = Math.atan2(p.y - T.g.cy, p.x - T.g.cx), dt = Math.max(1, ev.timeStamp - T.lastT) / 1000, d = wrap(th - T.lastTh);
      T.omega += (d / dt - T.omega) * (1 - Math.exp(-dt / 0.045)); T.theta += d; T.lastTh = th; T.lastT = ev.timeStamp;
    }
    send({ t: 'finger', i: T.g.id, f: { theta: T.theta, omega: T.omega } });
  });
  function endTouch(e) {
    const T = touches.get(e.pointerId); if (!T) return; touches.delete(e.pointerId);
    T.g.touch = null;
    if (T.g.keyRub) startKeyRub(T.g, T.g.keyFN); else send({ t: 'finger', i: T.g.id, f: { down: false } });
  }
  stage.addEventListener('pointerup', endTouch); stage.addEventListener('pointercancel', endTouch);
  document.addEventListener('gesturestart', e => e.preventDefault());

  // ------------------------------------------------------------ keys (on-screen + MIDI)
  const kc = $('keys'), kctx = kc.getContext('2d');
  let kLo = 60, kHi = 84, keyRects = [];
  const held = new Map();          // midi -> glass
  function layoutKeys() {
    let lo = Infinity, hi = -Infinity;
    for (const g of glasses) if (g.info) { lo = Math.min(lo, Math.ceil(ftom(g.info.fFull))); hi = Math.max(hi, Math.floor(ftom(g.info.fDry))); }
    if (!isFinite(lo)) return;
    while ([1, 3, 6, 8, 10].includes(((lo % 12) + 12) % 12)) lo--;
    while ([1, 3, 6, 8, 10].includes(((hi % 12) + 12) % 12)) hi++;
    kLo = lo; kHi = hi;
    const w = kc.width / dpr, h = kc.height / dpr, whites = [];
    for (let m = lo; m <= hi; m++) if (![1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)) whites.push(m);
    const ww = w / whites.length; keyRects = [];
    whites.forEach((m, i) => keyRects.push({ m, x: i * ww, y: 0, w: ww, h, black: false }));
    for (let m = lo; m <= hi; m++) if ([1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)) { const i = whites.indexOf(m - 1); if (i >= 0) keyRects.push({ m, x: (i + 1) * ww - ww * 0.32, y: 0, w: ww * 0.64, h: h * 0.6, black: true }); }
  }
  function inRangeAny(m) { const hz = mtof(m); return glasses.some(g => g.info && hz <= g.info.fDry * 1.003 && hz >= g.info.fFull * 0.997); }
  function drawKeys() {
    const c = kctx, w = kc.width / dpr, h = kc.height / dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    for (const k of keyRects.filter(k => !k.black).concat(keyRects.filter(k => k.black))) {
      const on = held.has(k.m), ok = inRangeAny(k.m);
      c.fillStyle = k.black ? (on ? '#3b6f99' : ok ? '#1a212c' : '#10141a') : (on ? '#9fd3ff' : ok ? '#dfe7f0' : '#5b6573');
      c.beginPath(); c.roundRect ? c.roundRect(k.x + 1, k.y, k.w - 2, k.h, [0, 0, 5, 5]) : c.rect(k.x + 1, k.y, k.w - 2, k.h); c.fill();
      if (!k.black && k.m % 12 === 0) { c.fillStyle = '#4d5a6b'; c.font = '10px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillText(nn(k.m), k.x + k.w / 2, h - 7); }
    }
    // mark the notes each glass is currently tuned to
    for (const g of glasses) if (isFinite(g.f)) { const m = Math.round(ftom(g.f)), k = keyRects.find(r => r.m === m); if (k) { c.fillStyle = '#3aa6d8'; c.beginPath(); c.arc(k.x + k.w / 2, k.y + (k.black ? k.h - 8 : k.h - 20), 3, 0, TAU); c.fill(); } }
  }
  function keyAt(x, y) { for (const k of keyRects) if (k.black && x >= k.x && x <= k.x + k.w && y <= k.h) return k.m; for (const k of keyRects) if (!k.black && x >= k.x && x <= k.x + k.w) return k.m; return null; }
  function allocate(m) {
    const hz = mtof(m), fits = g => g.info && hz <= g.info.fDry * 1.003 && hz >= g.info.fFull * 0.997;
    let pool = glasses.filter(g => fits(g) && g.held == null && g.touch == null);
    if (!pool.length) pool = glasses.filter(g => fits(g) && g.held == null);
    if (!pool.length) pool = glasses.filter(fits);
    if (!pool.length) {        // nobody can reach it: nearest range, clamped
      const dist = g => !g.info ? 1e9 : hz > g.info.fDry ? hz / g.info.fDry : g.info.fFull / hz;
      pool = glasses.filter(g => g.held == null).sort((a, b) => dist(a) - dist(b)).slice(0, 1);
      if (!pool.length) return null;
    }
    pool.sort((a, b) => (Math.round(ftom(b.f)) === m) - (Math.round(ftom(a.f)) === m) || a.lastUse - b.lastUse);
    return pool[0];
  }
  function startKeyRub(g, FN) { send({ t: 'finger', i: g.id, f: { down: true, theta: -Math.PI / 2, omega: TAU * 1.0, FN, cond: S.cond } }); }
  function noteOn(m, vel) {
    startAudio(); if (!started) { started = true; $('hint').classList.add('gone'); }
    if (held.has(m)) noteOff(m);
    const g = allocate(m); if (!g) return;
    if (g.held != null) held.delete(g.held);
    g.held = m; g.lastUse = performance.now(); held.set(m, g);
    pourTo(g, mtof(m)).then(() => { g.midi = m; });
    if (S.autorub && g.touch == null) {
      g.keyRub = true; g.keyFN = 0.5 + 1.6 * (vel / 127);
      startKeyRub(g, g.keyFN);
    }
  }
  function noteOff(m) {
    const g = held.get(m); if (!g) return; held.delete(m);
    if (g.held === m) g.held = null;
    if (g.keyRub) { g.keyRub = false; if (g.touch == null) send({ t: 'finger', i: g.id, f: { down: false } }); }
  }
  const keyTouches = new Map();
  kc.addEventListener('pointerdown', e => { e.preventDefault(); const p = pos(e, kc), m = keyAt(p.x, p.y); if (m == null) return; kc.setPointerCapture(e.pointerId); keyTouches.set(e.pointerId, m); noteOn(m, 90); }, { passive: false });
  kc.addEventListener('pointermove', e => { if (!keyTouches.has(e.pointerId)) return; const p = pos(e, kc), m = keyAt(p.x, p.y), old = keyTouches.get(e.pointerId); if (m != null && m !== old) { noteOff(old); keyTouches.set(e.pointerId, m); noteOn(m, 90); } });
  const keyUp = e => { const m = keyTouches.get(e.pointerId); if (m == null) return; keyTouches.delete(e.pointerId); noteOff(m); };
  kc.addEventListener('pointerup', keyUp); kc.addEventListener('pointercancel', keyUp);

  // Web MIDI (Chrome/Edge/Firefox on desktop & Android; not available in any iPad/iPhone browser)
  (async () => {
    const st = $('midiStat');
    if (!navigator.requestMIDIAccess) { st.textContent = 'MIDI: not supported by this browser (use the keys)'; return; }
    try {
      const acc = await navigator.requestMIDIAccess();
      const hook = () => {
        const names = [];
        acc.inputs.forEach(inp => { names.push(inp.name); inp.onmidimessage = ev => {
          const [s, d1, d2] = ev.data, type = s & 0xf0;
          if (type === 0x90 && d2 > 0) noteOn(d1, d2);
          else if (type === 0x80 || (type === 0x90 && d2 === 0)) noteOff(d1);
          else if (type === 0xb0 && d1 === 1) { S.FN = 0.2 + 2.8 * d2 / 127; $('press').value = S.FN; $('pressOut').textContent = S.FN.toFixed(2) + ' N'; glasses.forEach(g => send({ t: 'finger', i: g.id, f: { FN: S.FN } })); }
        }; });
        st.textContent = names.length ? 'MIDI: ' + names.join(', ') + ' · mod wheel = pressure' : 'MIDI: no input connected';
        st.classList.toggle('on', names.length > 0);
      };
      hook(); acc.onstatechange = hook;
    } catch (err) { st.textContent = 'MIDI: blocked here (' + (err.name || 'denied') + ')'; }
  })();

  // ------------------------------------------------------------ editor + settings
  let edG = null;
  const edShape = $('edShape'); for (const [k, v] of Object.entries(SHAPES)) edShape.add(new Option(v, k));
  function openEditor(g) { edG = g; refreshEditor(); $('sheet').classList.add('on'); }
  function refreshEditor() {
    const g = edG; if (!g) return;
    $('edTitle').textContent = `Glass ${g.id + 1}`;
    $('edNote').textContent = isFinite(g.f) ? nn(ftom(g.f)) : nn(g.midi);
    $('edHz').textContent = isFinite(g.f) ? `${g.f.toFixed(1)} Hz${g.info ? ` · range ${nn(Math.ceil(ftom(g.info.fFull)))}–${nn(Math.floor(ftom(g.info.fDry)))}` : ''}` : '—';
    $('edFill').value = (g.fill * 100).toFixed(1); $('edFillOut').textContent = `${Math.round(g.fill * 100)}% · ${Math.round((g.volume || 0) * 1e6)} mL`;
    $('edSize').value = Math.round(g.scale * 100); $('edSizeOut').textContent = `${Math.round(g.scale * 100)}% · Ø${g.info ? Math.round(g.info.rimR * 2000) : '—'} mm`;
    edShape.value = g.shape;
  }
  $('edClose').onclick = () => { $('sheet').classList.remove('on'); edG = null; };
  $('sheet').addEventListener('pointerdown', e => { if (e.target.id === 'sheet') { $('sheet').classList.remove('on'); edG = null; } });
  document.querySelectorAll('.ed-note button').forEach(b => b.onclick = () => { if (!edG) return; const base = isFinite(edG.f) ? Math.round(ftom(edG.f)) : edG.midi; edG.midi = base + +b.dataset.d; fit(edG); });
  let fillT = 0; $('edFill').oninput = e => { if (!edG) return; const g = edG, v = +e.target.value / 100; clearTimeout(fillT); fillT = setTimeout(() => setFillManual(g, v), 30); };
  let sizeT = 0; $('edSize').oninput = e => { if (!edG) return; const g = edG; g.scale = +e.target.value / 100; $('edSizeOut').textContent = `${e.target.value}%`; clearTimeout(sizeT); sizeT = setTimeout(() => rebuild(g), 250); };
  edShape.onchange = () => { if (!edG) return; edG.shape = edShape.value; fit(edG); };

  const matSel = $('material'); for (const [k, v] of Object.entries(MATERIALS)) matSel.add(new Option(v, k));
  const rootSel = $('root'); for (let m = 55; m <= 84; m++) rootSel.add(new Option(nn(m), m)); rootSel.value = S.root;
  const scSel = $('scale'); for (const [k, v] of Object.entries(SCALES)) scSel.add(new Option(v.name, k)); scSel.value = S.scale;
  $('settingsBtn').onclick = () => $('settings').classList.add('on');
  $('setClose').onclick = () => $('settings').classList.remove('on');
  $('settings').addEventListener('pointerdown', e => { if (e.target.id === 'settings') $('settings').classList.remove('on'); });
  document.querySelectorAll('#count button').forEach(b => b.onclick = () => { document.querySelectorAll('#count button').forEach(x => x.classList.toggle('on', x === b)); setCount(+b.dataset.v); });
  matSel.onchange = () => { S.material = matSel.value; glasses.forEach(g => fit(g)); };
  rootSel.onchange = () => { S.root = +rootSel.value; };
  scSel.onchange = () => { S.scale = scSel.value; };
  $('tuneScale').onclick = () => { S.root = +rootSel.value; tuneToScale(); };
  $('spread').onclick = () => { S.root = +rootSel.value; spreadForKeys(); };
  $('press').oninput = e => { S.FN = +e.target.value; $('pressOut').textContent = S.FN.toFixed(2) + ' N'; glasses.forEach(g => send({ t: 'finger', i: g.id, f: { FN: S.FN } })); };
  document.querySelectorAll('#cond button').forEach(b => b.onclick = () => { document.querySelectorAll('#cond button').forEach(x => x.classList.toggle('on', x === b)); S.cond = b.dataset.v; glasses.forEach(g => send({ t: 'finger', i: g.id, f: { cond: S.cond } })); });
  $('reverb').oninput = e => { S.reverb = +e.target.value / 100; $('reverbOut').textContent = e.target.value + '%'; applyMix(); };
  $('vol').oninput = e => { S.vol = +e.target.value / 100; $('volOut').textContent = e.target.value + '%'; applyMix(); };
  $('autorub').onchange = e => { S.autorub = e.target.checked; };

  // ------------------------------------------------------------ loop
  let last = performance.now(), layoutDirty = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; strobe += TAU * 0.8 * dt;
    for (const T of touches.values()) if (now - T.lastT > 40 && Math.abs(T.omega) > 1e-3) { T.omega *= Math.exp(-dt / 0.05); send({ t: 'finger', i: T.g.id, f: { theta: T.theta, omega: T.omega } }); }
    if (now - layoutDirty > 300) { layoutDirty = now; layout(); }
    sc.setTransform(dpr, 0, 0, dpr, 0, 0); sc.clearRect(0, 0, W, H);
    for (const g of glasses) drawGlass(g, now, dt);
    drawKeys();
    requestAnimationFrame(frame);
  }
  window.__harp = { get glasses() { return glasses; }, get audio() { return audio; }, noteOn, noteOff, S };
  glasses = Array.from({ length: S.count }, (_, i) => newGlass(i));
  resize(); tuneToScale();
  requestAnimationFrame(frame);
})();
