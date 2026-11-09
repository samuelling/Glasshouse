(() => {
  'use strict';
  const GP = window.GlassPhysics;
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const ALPHA = 0.37;            // orientation of the glass's tiny asymmetry
  const BOWL = (window.GH && window.GH.kind) === 'bowl';
  const EXAG = BOWL ? 8 : 35;    // visual exaggeration of rim motion
  const OUT_PA = 0.8;            // pressure (Pa) that maps to digital full scale before volume

  const S = BOWL
    ? { shape: 'thadobati', material: 'bellBronze', tScale: 1, scale: 1, fill: 0, FN: 4.0, stick: 'leather', side: 1, mallet: 'felt', split: 4e-3, reverb: 0.3, vol: 0.8 }
    : { shape: 'bordeaux', material: 'leadCrystal', tRim: 1.2e-3, scale: 1, fill: 0, FN: 1.0, cond: 'wet', split: 3e-4, reverb: 0.25, vol: 0.8 };
  const kindOK = v => (v.kind || 'glass') === (BOWL ? 'bowl' : 'glass') || v.kind === 'both';
  let glass = null, wet = null, modeByKey = new Map(), prof = null, curve = null, curveJob = 0;
  let audio = null, snap = null, started = false;

  // ------------------------------------------------------------ UI wiring
  const shapeSel = $('shape'), matSel = $('material');
  for (const [k, v] of Object.entries(GP.SHAPES)) if (kindOK(v)) shapeSel.add(new Option(v.name, k));
  for (const [k, v] of Object.entries(GP.MATERIALS)) if (kindOK(v)) matSel.add(new Option(v.name, k));
  shapeSel.value = S.shape; matSel.value = S.material;

  function paintRange(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }
  document.querySelectorAll('input[type=range]').forEach(el => { paintRange(el); el.addEventListener('input', () => paintRange(el)); });

  let rebuildT = 0;
  const scheduleRebuild = () => { clearTimeout(rebuildT); rebuildT = setTimeout(build, 220); };
  shapeSel.onchange = () => { S.shape = shapeSel.value; const sm = GP.SHAPES[S.shape].mat; if (sm) { S.material = sm; matSel.value = sm; } else if (BOWL && S.material === 'fusedQuartz') { S.material = 'bellBronze'; matSel.value = 'bellBronze'; } build(); };
  matSel.onchange = () => { S.material = matSel.value; build(); };
  $('thick').oninput = e => { if (BOWL) { S.tScale = +e.target.value; $('thickOut').textContent = '×' + S.tScale.toFixed(2); } else { S.tRim = +e.target.value * 1e-3; $('thickOut').textContent = (+e.target.value).toFixed(2) + ' mm'; } scheduleRebuild(); };
  $('size').oninput = e => { S.scale = +e.target.value / 100; $('sizeOut').textContent = e.target.value + '%'; scheduleRebuild(); };
  $('press').oninput = e => { S.FN = +e.target.value; $('pressOut').textContent = S.FN.toFixed(BOWL ? 1 : 2) + ' N'; send({ t: 'finger', f: { FN: S.FN } }); };
  $('split').oninput = e => { S.split = +e.target.value / 100; $('splitOut').textContent = (+e.target.value).toFixed(3) + '%'; sendModes(); };
  $('reverb').oninput = e => { S.reverb = +e.target.value / 100; $('reverbOut').textContent = e.target.value + '%'; applyMix(); };
  $('vol').oninput = e => { S.vol = +e.target.value / 100; $('volOut').textContent = e.target.value + '%'; applyMix(); };
  let fillRAF = 0;
  function setFill(f, fromSlider) {
    S.fill = Math.max(0, Math.min(0.95, f));
    if (!fromSlider) { $('fill').value = (S.fill * 100).toFixed(1); paintRange($('fill')); }
    if (!fillRAF) fillRAF = requestAnimationFrame(() => { fillRAF = 0; if (glass) updateWet(); });
  }
  $('fill').oninput = e => setFill(+e.target.value / 100, true);
  const seg = (id, fn) => document.querySelectorAll('#' + id + ' button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#' + id + ' button').forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset.v);
  });
  if (BOWL) {
    seg('stick', v => { S.stick = v; sendExciter(); });
    seg('sideSel', v => { S.side = +v; sendExciter(); });
    seg('mallet', v => { S.mallet = v; });
  } else seg('cond', v => { S.cond = v; send({ t: 'finger', f: { cond: S.cond } }); });
  function sendExciter() { if (BOWL) send({ t: 'exciter', e: { kind: 'puja', stick: S.stick, side: S.side } }); }
  const MALLET = { felt: { force: 45, dur: 2.5e-3 }, wood: { force: 70, dur: 4e-4 } };

  // ------------------------------------------------------------ physics
  function busy(on, msg) { $('busy').classList.toggle('on', on); if (msg) $('busyMsg').textContent = msg; }
  function build() {
    busy(true, 'Solving shell modes…');
    setTimeout(() => {
      const t0 = performance.now();
      glass = GP.buildGlass(BOWL ? { shape: S.shape, material: S.material, scale: S.scale, tScale: S.tScale, Ne: 36, nKeep: 8 } : { shape: S.shape, material: S.material, tRim: S.tRim, scale: S.scale, Ne: 36, nKeep: 8 });
      prof = GP.profile(glass, 120);
      updateWet();
      busy(false);
      console.log('shell solve', (performance.now() - t0).toFixed(0), 'ms');
      computeCurve();
    }, 30);
  }
  function updateWet() {
    wet = GP.wetModes(glass, S.fill, BOWL ? { perN: 2, fmax: 9000, shapes: true, contactDepth: 0.015 * S.scale } : { perN: 2, fmax: 12000, shapes: true });
    wet.rc = glass.geo.at(wet.contactS).r;
    modeByKey = new Map(wet.modes.map(m => [m.key, m]));
    $('fillOut').textContent = `${Math.round(S.fill * 100)}% · ${Math.round(wet.volume * 1e6)} mL`;
    sendModes(); renderTable(); if (curve) drawCurve();
  }
  function sendModes() {
    if (!wet) return;
    const modes = wet.modes.map(({ shape, ...m }) => m);
    send({ t: 'modes', modes, opt: { split: S.split, alpha: ALPHA, Rrim: wet.rc || glass.geo.rimR } });
  }
  function computeCurve() {
    const job = ++curveJob, g = glass, pts = [], N = 24;
    let i = 0;
    const step = () => {
      if (job !== curveJob) return;
      const f = 0.95 * i / N, w = GP.wetModes(g, f, { perN: 1, fmax: 3000 });
      const m = w.modes.find(x => x.n === 2);
      pts.push({ f, hz: m ? m.f : NaN });
      if (++i <= N) setTimeout(step, 0); else { curve = pts; drawCurve(); }
    };
    curve = null; step();
  }

  // ------------------------------------------------------------ table
  function renderTable() {
    const tb = $('modeTable').tBodies[0]; tb.innerHTML = '';
    for (const m of wet.modes) {
      const tot = m.zeta, tr = document.createElement('tr'); tr.dataset.key = m.key;
      const pc = x => (100 * x / tot).toFixed(1) + '%';
      tr.innerHTML = `<td>(${m.n},${m.m})</td><td>${fmtHz(m.f)}</td><td>${fmtHz(m.fDry)}</td><td>${Math.round(m.Q)}</td>` +
        `<td class="bar"><div class="lb" title="material ${pc(m.zMat)} · radiation ${pc(m.zRad)} · water ${pc(m.zVis)} · support ${pc(m.zSup)}"><i class="l-mat" style="width:${pc(m.zMat)}"></i><i class="l-rad" style="width:${pc(m.zRad)}"></i><i class="l-vis" style="width:${pc(m.zVis)}"></i><i class="l-sup" style="width:${pc(m.zSup)}"></i></div></td>`;
      tb.appendChild(tr);
    }
  }
  const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(2) + ' k' : f.toFixed(1);
  const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  function noteName(f) { const m = 69 + 12 * Math.log2(f / 440), r = Math.round(m), c = Math.round((m - r) * 100); return NOTES[(r % 12 + 12) % 12] + (Math.floor(r / 12) - 1) + (c >= 0 ? ' +' : ' −') + Math.abs(c) + '¢'; }

  // ------------------------------------------------------------ audio
  function send(m) { if (audio) audio.send(m); }
  const WRAP = `
class GlassProc extends AudioWorkletProcessor {
  constructor() { super(); this.v = new globalThis.GlassDSP.GlassVoice(sampleRate); this.n = 0;
    this.port.onmessage = e => { const m = e.data;
      if (m.t === 'modes') this.v.setModes(m.modes, m.opt); else if (m.t === 'finger') this.v.setFinger(m.f); else if (m.t === 'exciter') this.v.setExciter(m.e);
      else if (m.t === 'tap') this.v.tap(m.theta, m.force, m.dur); else if (m.t === 'gain') this.v.gain = m.g; }; }
  process(inp, out) { const o = out[0]; const L = o[0], R = o[1] || o[0]; this.v.process(L, R, L.length);
    if (++this.n % 5 === 0) this.port.postMessage(this.v.snapshot()); return true; }
}
registerProcessor('glass-proc', GlassProc);`;

  function makeIR(ctx, secs) {
    const sr = ctx.sampleRate, n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, k = Math.min(0.92, 0.2 + t * 0.9);      // highs decay faster
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        d[i] = lp * Math.exp(-6.9 * t / secs) * (t < 0.012 ? 0 : 1) * 2.2;
      }
      for (const [dt, a] of [[0.013, 0.5], [0.021, 0.35], [0.034, 0.25], [0.047, 0.2]]) { const j = Math.floor((dt + c * 0.003) * sr); if (j < n) d[j] += a; }
    }
    return b;
  }

  async function startAudio() {
    if (audio) { if (audio.ctx.state !== 'running') audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    const queue = []; audio = { ctx, send: m => queue.push(m) };
    ctx.resume();
    const src = $('dsp-src').textContent;
    const master = ctx.createGain(), comp = ctx.createDynamicsCompressor(), dry = ctx.createGain(), wetG = ctx.createGain(), conv = ctx.createConvolver();
    comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 10; comp.attack.value = 0.002; comp.release.value = 0.2;
    conv.buffer = makeIR(ctx, 2.2);
    dry.connect(comp); conv.connect(wetG); wetG.connect(comp); comp.connect(master); master.connect(ctx.destination);
    audio.master = master; audio.dry = dry; audio.wetG = wetG;
    let node;
    try {
      const url = URL.createObjectURL(new Blob([src + '\n' + WRAP], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      node = new AudioWorkletNode(ctx, 'glass-proc', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = e => { snap = e.data; };
      audio.send = m => node.port.postMessage(m);
    } catch (err) {
      console.warn('AudioWorklet unavailable, using ScriptProcessor', err);
      if (!window.GlassDSP) (new Function(src))();
      const V = new window.GlassDSP.GlassVoice(ctx.sampleRate);
      node = ctx.createScriptProcessor(512, 0, 2);
      node.onaudioprocess = e => { V.process(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1), e.outputBuffer.length); snap = V.snapshot(); };
      audio.send = m => { if (m.t === 'modes') V.setModes(m.modes, m.opt); else if (m.t === 'finger') V.setFinger(m.f); else if (m.t === 'exciter') V.setExciter(m.e); else if (m.t === 'tap') V.tap(m.theta, m.force, m.dur); else if (m.t === 'gain') V.gain = m.g; };
    }
    node.connect(dry); node.connect(conv);
    audio.node = node;
    applyMix();
    send({ t: 'gain', g: 1 / OUT_PA });
    if (BOWL) sendExciter(); else send({ t: 'finger', f: { FN: S.FN, cond: S.cond } });
    send({ t: 'finger', f: { FN: S.FN } });
    sendModes();
    for (const m of queue) audio.send(m);
  }
  function applyMix() {
    if (!audio || !audio.master) return;
    const t = audio.ctx.currentTime;
    audio.master.gain.setTargetAtTime(S.vol * S.vol * 1.4, t, 0.03);
    audio.dry.gain.setTargetAtTime(1 - 0.55 * S.reverb, t, 0.03);
    audio.wetG.gain.setTargetAtTime(0.9 * S.reverb, t, 0.03);
  }

  // ------------------------------------------------------------ top view
  const top = $('top'), tctx = top.getContext('2d');
  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, pxPerM = 1;
  function resize() {
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const r = top.getBoundingClientRect(); W = r.width; H = r.height;
    top.width = Math.round(W * dpr); top.height = Math.round(H * dpr);
    for (const cv of [$('sideCv'), $('curveCv')]) { const b = cv.getBoundingClientRect(); cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr); }
    drawCurve();
  }
  new ResizeObserver(resize).observe(document.body);

  const FOOT_R = 0.039;
  function layout() {
    cx = W / 2; cy = H / 2;
    const rMax = BOWL ? Math.max(glass.geo.rMaxOuter, glass.geo.rimR) * 1.18 : Math.max(glass.geo.rMaxOuter, FOOT_R * S.scale, glass.geo.rimR * 1.15);
    pxPerM = 0.44 * Math.min(W, H) / rMax;
  }

  // pointer → finger
  const P = { id: null, down: false, theta: 0, omega: 0, lastT: 0, lastTh: 0, mode: null, start: 0, moved: 0, x: 0, y: 0 };
  function polar(e) { const r = top.getBoundingClientRect(); const x = e.clientX - r.left - cx, y = e.clientY - r.top - cy; return { r: Math.hypot(x, y) / pxPerM, th: Math.atan2(y, x), x, y }; }
  top.addEventListener('pointerdown', e => {
    e.preventDefault();
    startAudio();
    if (!started) { started = true; $('hint').classList.add('gone'); }
    if (!glass || P.id !== null) return;
    const p = polar(e), R = glass.geo.rimR, tol = Math.max(0.2 * R, 22 / pxPerM);
    if (Math.abs(p.r - R) <= tol || p.r > R) {
      P.id = e.pointerId; top.setPointerCapture(e.pointerId); top.classList.add('rubbing');
      P.mode = 'rub'; P.down = true; P.theta = p.th; P.lastTh = p.th; P.lastT = e.timeStamp; P.omega = 0;
      send({ t: 'finger', f: { down: true, theta: p.th, omega: 0, FN: S.FN, cond: S.cond } });
    } else {
      // flick with a fingernail: force scales a little with how far out you tap
      if (BOWL) { const M = MALLET[S.mallet]; send({ t: 'tap', theta: p.th, force: M.force * (0.5 + 0.5 * Math.min(1, p.r / R)), dur: M.dur }); }
      else send({ t: 'tap', theta: p.th, force: 4 + 6 * Math.min(1, p.r / R) });
      flashes.push({ th: p.th, r: p.r, t: performance.now() });
    }
  }, { passive: false });
  top.addEventListener('pointermove', e => {
    if (e.pointerId !== P.id || !P.down) return;
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null; if (!evs || !evs.length) evs = [e];
    for (const ev of evs) {
      const p = polar(ev), dt = Math.max(1, ev.timeStamp - P.lastT) / 1000;
      const d = wrap(p.th - P.lastTh);
      const inst = d / dt, a = 1 - Math.exp(-dt / 0.045);
      P.omega += (inst - P.omega) * a;
      P.theta += d; P.lastTh = p.th; P.lastT = ev.timeStamp;
    }
    send({ t: 'finger', f: { theta: P.theta, omega: P.omega } });
  });
  function endPointer(e) {
    if (e.pointerId !== P.id) return;
    P.id = null; P.down = false; P.omega = 0; top.classList.remove('rubbing');
    send({ t: 'finger', f: { down: false } });
  }
  top.addEventListener('pointerup', endPointer); top.addEventListener('pointercancel', endPointer);
  document.addEventListener('keydown', e => { if (e.key === ' ' && audio) { send({ t: 'tap', theta: Math.PI / 2, force: 6 }); e.preventDefault(); } });

  // visual state
  const flashes = [], drops = [];
  let strobe = 0, lastFrame = performance.now(), envSmooth = null;
  const NTH = 240, envR = new Float64Array(NTH), dispR = new Float64Array(NTH), envW = new Float64Array(NTH);

  function analyse() {
    envR.fill(0); dispR.fill(0); envW.fill(0);
    let dom = null, domA = 0, rimMax = 0;
    if (!snap || !wet) return { dom, rimMax };
    const pairs = new Map();
    for (let k = 0; k < snap.keys.length; k++) {
      const key = snap.keys[k], base = key.slice(0, -1), m = modeByKey.get(base); if (!m) continue;
      let p = pairs.get(base); if (!p) { p = { m, a: [0, 0], b: [0, 0] }; pairs.set(base, p); }
      const z = [snap.amps[2 * k], snap.amps[2 * k + 1]];
      if (key.endsWith('B')) p.b = z; else p.a = z;
    }
    const cs = Math.cos(strobe), sn = Math.sin(strobe);
    for (const p of pairs.values()) {
      const { m, a, b } = p, amp = Math.hypot(a[0], a[1], b[0], b[1]) * Math.abs(m.rimR);
      if (amp > domA) { domA = amp; dom = m; }
      for (let i = 0; i < NTH; i++) {
        const th = TAU * i / NTH - ALPHA, c = Math.cos(m.n * th), s = Math.sin(m.n * th);
        const re = a[0] * c + b[0] * s, im = a[1] * c + b[1] * s;
        const xr = m.rimR * re, xi = m.rimR * im;
        envR[i] += xr * xr + xi * xi;
        dispR[i] += xr * cs - xi * sn;
        const wr = m.wl * re, wi = m.wl * im; envW[i] += wr * wr + wi * wi;
      }
    }
    for (let i = 0; i < NTH; i++) { envR[i] = Math.sqrt(envR[i]); envW[i] = Math.sqrt(envW[i]); rimMax = Math.max(rimMax, envR[i]); }
    return { dom, rimMax, pairs };
  }

  function drawTop(an, now) {
    const c = tctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    if (!glass) return;
    layout();
    const g = glass.geo, R = g.rimR * pxPerM, tr = g.rim.t * pxPerM;
    // shadow on the table
    const sh = c.createRadialGradient(cx + 10, cy + 16, R * 0.2, cx + 10, cy + 16, R * 1.5);
    sh.addColorStop(0, 'rgba(0,0,0,.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sh; c.beginPath(); c.arc(cx + 10, cy + 16, R * 1.5, 0, TAU); c.fill();
    if (BOWL) drawBowlBody(c, g, R, tr);
    else {
    // foot (seen through the bowl)
    const fR = FOOT_R * S.scale * pxPerM;
    c.strokeStyle = 'rgba(200,220,245,.10)'; c.lineWidth = 1.2; c.beginPath(); c.arc(cx, cy, fR, 0, TAU); c.stroke();
    c.strokeStyle = 'rgba(200,220,245,.05)'; c.lineWidth = 5; c.beginPath(); c.arc(cx, cy, fR - 3, 0, TAU); c.stroke();
    // bowl belly
    const bR = g.rMaxOuter * pxPerM;
    if (bR > R + 2) {
      const bg = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, bR);
      bg.addColorStop(0, 'rgba(210,230,255,0)'); bg.addColorStop(0.85, 'rgba(210,230,255,.07)'); bg.addColorStop(1, 'rgba(210,230,255,.16)');
      c.fillStyle = bg; c.beginPath(); c.arc(cx, cy, bR, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(220,235,255,.22)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, bR, 0, TAU); c.stroke();
    }
    // bowl interior
    const ig = c.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R);
    ig.addColorStop(0, 'rgba(230,240,255,.07)'); ig.addColorStop(0.7, 'rgba(160,190,230,.04)'); ig.addColorStop(1, 'rgba(200,220,255,.12)');
    c.fillStyle = ig; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    // stem junction highlight
    { const sr = Math.max(2, g.inner.r[0] * pxPerM), sg = c.createRadialGradient(cx, cy, 0, cx, cy, sr * 1.6); sg.addColorStop(0, 'rgba(230,240,255,.16)'); sg.addColorStop(1, 'rgba(230,240,255,0)'); c.fillStyle = sg; c.beginPath(); c.arc(cx, cy, sr * 1.6, 0, TAU); c.fill(); }
    }
    // water
    if (S.fill > 0.003 && wet) {
      const wR = g.innerAtZ(wet.h).r * pxPerM;
      const wg = c.createRadialGradient(cx - wR * 0.25, cy - wR * 0.3, wR * 0.1, cx, cy, wR);
      wg.addColorStop(0, 'rgba(90,180,230,.30)'); wg.addColorStop(0.8, 'rgba(40,120,180,.30)'); wg.addColorStop(1, 'rgba(120,200,240,.55)');
      c.fillStyle = wg; c.beginPath(); c.arc(cx, cy, wR, 0, TAU); c.fill();
      // meniscus
      c.strokeStyle = 'rgba(170,225,255,.6)'; c.lineWidth = 1.2; c.beginPath(); c.arc(cx, cy, wR - 0.6, 0, TAU); c.stroke();
      drawRipples(c, wR, now);
    }
    // vibration envelope band
    const X = EXAG * pxPerM, lim = 0.16 * R;
    if (an.rimMax * X > 0.3) {
      c.fillStyle = BOWL ? 'rgba(255,214,140,.16)' : 'rgba(159,211,255,.13)';
      c.beginPath();
      for (let i = 0; i <= NTH; i++) { const k = i % NTH, th = TAU * k / NTH, d = Math.min(lim, envR[k] * X); const r = R + tr / 2 + d; i ? c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th)) : c.moveTo(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
      for (let i = NTH; i >= 0; i--) { const k = i % NTH, th = TAU * k / NTH, d = Math.min(lim, envR[k] * X); const r = R - tr / 2 - d; c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
      c.closePath(); c.fill('evenodd');
    }
    // rim (deformed, strobed)
    const rimPath = (off) => {
      c.beginPath();
      for (let i = 0; i <= NTH; i++) { const k = i % NTH, th = TAU * k / NTH, d = lim * Math.tanh(dispR[k] * X / lim), r = R + off + d; i ? c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th)) : c.moveTo(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
    };
    c.lineJoin = 'round';
    if (BOWL) {
      rimPath(0); c.strokeStyle = 'rgba(70,45,20,.9)'; c.lineWidth = Math.max(4, tr * 1.25); c.stroke();
      rimPath(0); const rg = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R); rg.addColorStop(0, '#f6d58e'); rg.addColorStop(0.45, '#b98a43'); rg.addColorStop(0.7, '#e9c47a'); rg.addColorStop(1, '#8a6330');
      c.strokeStyle = rg; c.lineWidth = Math.max(3, tr * 0.95); c.stroke();
      rimPath(-tr * 0.25); c.strokeStyle = 'rgba(255,240,200,.45)'; c.lineWidth = 1; c.stroke();
    } else {
    rimPath(0); c.strokeStyle = 'rgba(225,238,255,.20)'; c.lineWidth = Math.max(3, tr * 1.6); c.stroke();
    rimPath(0); c.strokeStyle = 'rgba(240,248,255,.85)'; c.lineWidth = Math.max(1.4, tr * 0.7); c.stroke();
    rimPath(-tr * 0.5); c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1; c.stroke();
    }
    // nodes of the dominant mode
    if (an.dom && an.rimMax * X > 1) {
      const dm = an.pairs.get(an.dom.key);
      if (dm) {
        const n = an.dom.n, a = dm.a, b = dm.b;
        // node angles where |a cos + b sin| is minimal → sample
        c.fillStyle = 'rgba(242,195,139,.9)';
        for (let i = 0; i < NTH; i++) {
          const f = j => { const th = TAU * ((j + NTH) % NTH) / NTH - ALPHA, cc = Math.cos(n * th), ss = Math.sin(n * th); return Math.hypot(a[0] * cc + b[0] * ss, a[1] * cc + b[1] * ss); };
          const v = f(i); if (v < f(i - 1) && v <= f(i + 1) && v < 0.35 * Math.hypot(a[0], a[1], b[0], b[1])) {
            const th = TAU * i / NTH; c.beginPath(); c.arc(cx + (R + tr + 7) * Math.cos(th), cy + (R + tr + 7) * Math.sin(th), 2.2, 0, TAU); c.fill();
          }
        }
      }
    }
    // tap flashes
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i], age = (now - f.t) / 600; if (age > 1) { flashes.splice(i, 1); continue; }
      const x = cx + R * Math.cos(f.th), y = cy + R * Math.sin(f.th);
      c.strokeStyle = `rgba(242,195,139,${0.7 * (1 - age)})`; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 6 + 30 * age, 0, TAU); c.stroke();
    }
    // finger / puja
    const fd = snap && snap.down ? snap.theta : (P.down ? P.theta : null);
    if (BOWL && fd != null && P.down) drawPuja(c, fd, R, tr, X);
    else if (fd != null && P.down) {
      const fx = cx + R * Math.cos(fd), fy = cy + R * Math.sin(fd), fr = Math.max(14, 0.0075 * pxPerM);
      const fg = c.createRadialGradient(fx - fr * 0.3, fy - fr * 0.3, fr * 0.1, fx, fy, fr);
      fg.addColorStop(0, 'rgba(246,214,190,.55)'); fg.addColorStop(1, 'rgba(220,170,140,.22)');
      c.fillStyle = fg; c.beginPath(); c.arc(fx, fy, fr, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255,235,220,.5)'; c.lineWidth = 1; c.stroke();
      // ridges
      c.save(); c.beginPath(); c.arc(fx, fy, fr, 0, TAU); c.clip();
      c.strokeStyle = 'rgba(150,100,80,.18)'; c.lineWidth = 0.8;
      for (let k = 1; k < 7; k++) { c.beginPath(); c.ellipse(fx, fy + fr * 0.15, fr * 0.16 * k, fr * 0.12 * k, fd, 0, TAU); c.stroke(); }
      c.restore();
    }
    // listener marker
    c.fillStyle = 'rgba(135,148,166,.5)'; c.font = '500 10px "IBM Plex Mono", monospace'; c.textAlign = 'center';
    c.fillText('▲ mics', cx, H - 10);
  }

  // hand-hammered bronze, seen from above
  let hammer = null;
  function drawBowlBody(c, g, R, tr) {
    const bR = Math.max(R, g.rMaxOuter * pxPerM);
    // outer flank (visible where the belly is wider than the rim)
    if (bR > R + 1) {
      const og = c.createRadialGradient(cx - bR * 0.3, cy - bR * 0.3, R * 0.6, cx, cy, bR);
      og.addColorStop(0, '#5b3f1d'); og.addColorStop(0.75, '#7a5427'); og.addColorStop(1, '#3b2710');
      c.fillStyle = og; c.beginPath(); c.arc(cx, cy, bR, 0, TAU); c.fill();
    }
    // interior: warm bronze with a darker patina toward the bottom
    const ig = c.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R);
    ig.addColorStop(0, '#6b4a22'); ig.addColorStop(0.35, '#7d5a2b'); ig.addColorStop(0.8, '#a57a3c'); ig.addColorStop(1, '#c9a05a');
    c.fillStyle = ig; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    // hammer marks (deterministic per bowl)
    if (!hammer || hammer.key !== S.shape + S.scale) {
      let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      hammer = { key: S.shape + S.scale, marks: Array.from({ length: 240 }, () => ({ r: Math.sqrt(rnd()) * 0.95, th: rnd() * TAU, s: 0.025 + 0.03 * rnd(), a: rnd() })) };
    }
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip();
    for (const m of hammer.marks) {
      const x = cx + m.r * R * Math.cos(m.th), y = cy + m.r * R * Math.sin(m.th), s = m.s * R;
      const hg = c.createRadialGradient(x - s * 0.35, y - s * 0.35, 0, x, y, s);
      hg.addColorStop(0, `rgba(255,225,160,${0.04 + 0.05 * m.a})`); hg.addColorStop(0.7, 'rgba(255,225,160,0)'); hg.addColorStop(1, `rgba(40,25,10,${0.05 + 0.05 * m.a})`);
      c.fillStyle = hg; c.beginPath(); c.ellipse(x, y, s * 1.3, s * 0.7, m.th + 1.2, 0, TAU); c.fill();
    }
    // lathe rings near the rim and the floor
    c.strokeStyle = 'rgba(255,230,170,.10)'; c.lineWidth = 1;
    for (const f of [0.93, 0.89, 0.86, 0.32, 0.28]) { c.beginPath(); c.arc(cx, cy, R * f, 0, TAU); c.stroke(); }
    // specular sweep
    const sg = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R); sg.addColorStop(0.2, 'rgba(255,240,200,0)'); sg.addColorStop(0.42, 'rgba(255,240,200,.12)'); sg.addColorStop(0.5, 'rgba(255,240,200,0)');
    c.fillStyle = sg; c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c.restore();
  }
  // puja: wooden stick seen end-on, held against the outside (or inside) of the wall
  function drawPuja(c, th, R, tr, X) {
    const side = S.side, rad = Math.max(10, 0.013 * pxPerM);
    const jitter = snap ? snap.y * X * side : 0;                  // stick's radial motion, same exaggeration as the rim
    const rr = R + side * (tr * 0.5 + rad) + Math.max(-rad, Math.min(rad, jitter));
    const x = cx + rr * Math.cos(th), y = cy + rr * Math.sin(th);
    const leather = S.stick === 'leather';
    const g2 = c.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
    if (leather) { g2.addColorStop(0, '#a1785a'); g2.addColorStop(1, '#5d3e2a'); } else { g2.addColorStop(0, '#d9b98a'); g2.addColorStop(1, '#8a6238'); }
    c.fillStyle = g2; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.stroke();
    // growth rings (wood) or stitching (leather)
    c.strokeStyle = leather ? 'rgba(240,220,190,.35)' : 'rgba(90,60,30,.35)';
    if (leather) { c.setLineDash([2, 3]); c.beginPath(); c.arc(x, y, rad * 0.78, 0, TAU); c.stroke(); c.setLineDash([]); }
    else for (let k = 1; k < 5; k++) { c.beginPath(); c.arc(x + 1, y - 1, rad * k / 5, 0, TAU); c.stroke(); }
    // rattle: contact lost part of the time
    if (snap && snap.down && snap.contact < 0.97) {
      const a = Math.min(1, (0.97 - snap.contact) * 4);
      c.strokeStyle = `rgba(255,210,140,${0.8 * a})`; c.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) { const ang = th + (Math.random() - 0.5) * 0.25, r1 = R + side * (tr + 2), r2 = r1 + side * (4 + 8 * Math.random());
        c.beginPath(); c.moveTo(cx + r1 * Math.cos(ang), cy + r1 * Math.sin(ang)); c.lineTo(cx + r2 * Math.cos(ang), cy + r2 * Math.sin(ang)); c.stroke(); }
    }
  }

  function drawRipples(c, wR, now) {
    const t = now / 1000, lam = Math.max(2.2, 0.0016 * pxPerM);
    let maxW = 0; for (let i = 0; i < NTH; i++) maxW = Math.max(maxW, envW[i]);
    if (maxW < 2e-7) return;
    const segs = 120;
    for (let s = 0; s < segs; s++) {
      const i0 = Math.floor(s * NTH / segs), a = envW[i0];
      const strength = Math.min(1, a / 6e-6);
      if (strength < 0.03) continue;
      const th0 = TAU * s / segs, th1 = TAU * (s + 1) / segs;
      for (let k = 0; k < 8; k++) {
        const r = wR - 1.5 - k * lam * 0.9; if (r < 4) break;
        const al = strength * Math.exp(-k / (1.5 + 3 * strength)) * (0.55 + 0.45 * Math.sin(TAU * (t * 9 - k * 0.5) + s * 0.7));
        c.strokeStyle = `rgba(200,240,255,${0.42 * al})`; c.lineWidth = 1;
        c.beginPath(); c.arc(cx, cy, r, th0, th1); c.stroke();
      }
      // spray: real singing glasses throw droplets from the antinodes when driven hard
      if (a > 4e-5 && Math.random() < 0.04 * (a / 4e-5) && drops.length < 120) {
        drops.push({ th: th0 + Math.random() * (th1 - th0), r: wR - 2, v: 20 + 50 * Math.random(), t: now, life: 300 + 400 * Math.random() });
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i], age = (now - d.t) / d.life; if (age > 1) { drops.splice(i, 1); continue; }
      const r = d.r - d.v * age * 0.6, h = Math.sin(Math.PI * age);
      c.fillStyle = `rgba(220,245,255,${0.7 * (1 - age)})`;
      c.beginPath(); c.arc(cx + r * Math.cos(d.th), cy + r * Math.sin(d.th), 0.8 + 1.8 * h, 0, TAU); c.fill();
    }
  }

  // ------------------------------------------------------------ side view
  const side = $('sideCv'), sctx = side.getContext('2d');
  let sideMap = null, sideDrag = false;
  function drawSide(an) {
    const c = sctx, w = side.width / dpr, h = side.height / dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!glass || !prof) return;
    const g = glass.geo, stemL = BOWL ? 0.018 * S.scale : 0.075 * S.scale, footR = BOWL ? g.rMaxOuter * 0.55 : FOOT_R * S.scale;
    const zTop = g.rim.z + 0.004, zBot = -stemL - 0.004, rW = Math.max(g.rMaxOuter, footR) * 1.15;
    const sc = Math.min((h - 16) / (zTop - zBot), (w - 20) / (2 * rW)), ox = w / 2, oy = h - 8 + zBot * sc;
    const X = (r) => ox + r * sc, Y = (z) => oy - z * sc;
    sideMap = { Y, sc, oy, zf: g.zFloor, zr: g.zRimIn };
    // stem + foot (glass) or ring cushion (bowl)
    c.fillStyle = 'rgba(210,228,250,.10)'; c.strokeStyle = 'rgba(220,235,255,.35)'; c.lineWidth = 1;
    const r0 = prof[0].r;
    if (BOWL) {
      c.fillStyle = '#5a2330'; c.strokeStyle = 'rgba(255,200,210,.25)';
      c.beginPath(); c.ellipse(X(-footR * 0.62), Y(-stemL / 2), footR * 0.38 * sc, stemL / 2 * sc, 0, 0, TAU); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(X(footR * 0.62), Y(-stemL / 2), footR * 0.38 * sc, stemL / 2 * sc, 0, 0, TAU); c.fill(); c.stroke();
    } else {
    c.beginPath(); c.moveTo(X(-r0), Y(0)); c.quadraticCurveTo(X(-r0 * 0.55), Y(-stemL * 0.5), X(-r0 * 0.7), Y(-stemL + 0.004));
    c.quadraticCurveTo(X(-footR * 0.4), Y(-stemL + 0.001), X(-footR), Y(-stemL)); c.lineTo(X(footR), Y(-stemL));
    c.quadraticCurveTo(X(footR * 0.4), Y(-stemL + 0.001), X(r0 * 0.7), Y(-stemL + 0.004));
    c.quadraticCurveTo(X(r0 * 0.55), Y(-stemL * 0.5), X(r0), Y(0)); c.closePath(); c.fill(); c.stroke();
    }
    // water
    if (S.fill > 0.003 && wet) {
      const I = g.inner; c.beginPath(); let started = false;
      const pts = [];
      for (let i = 0; i < I.z.length; i += 4) { if (I.z[i] > wet.h) break; pts.push([I.r[i], I.z[i]]); }
      const top = g.innerAtZ(wet.h); pts.push([top.r, wet.h]);
      c.moveTo(X(-pts[0][0]), Y(pts[0][1]));
      for (const p of pts) c.lineTo(X(-p[0]), Y(p[1]));
      for (let i = pts.length - 1; i >= 0; i--) c.lineTo(X(pts[i][0]), Y(pts[i][1]));
      c.closePath();
      const wg = c.createLinearGradient(0, Y(wet.h), 0, Y(g.zFloor)); wg.addColorStop(0, 'rgba(80,175,230,.55)'); wg.addColorStop(1, 'rgba(30,100,160,.45)');
      c.fillStyle = wg; c.fill();
      c.strokeStyle = 'rgba(170,225,255,.9)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(-top.r), Y(wet.h)); c.lineTo(X(top.r), Y(wet.h)); c.stroke();
    }
    // bowl wall, displaced by the dominant mode shape (strobed)
    let shape = null, n = 2, ampPx = 0;
    if (an.dom && an.dom.shape) {
      shape = an.dom.shape; n = an.dom.n;
      const rimW = shape[shape.length - 1] || 1;
      ampPx = 10 * Math.tanh(an.rimMax * EXAG * sc / 10) / Math.abs(rimW);
    }
    const wall = (sign) => {
      const outer = [], inner = [];
      if (BOWL) { const p = prof[0]; outer.push([0, p.z - p.t / 2]); inner.push([0, p.z + p.t / 2]); }   // close the bowl across the axis
      const sgn = sign > 0 ? 1 : (n % 2 ? -1 : 1);
      for (let i = 0; i < prof.length; i++) {
        const p = prof[i], u = i / (prof.length - 1);
        let d = 0; if (shape) { const j = u * (shape.length - 1), j0 = Math.floor(j), f = j - j0; d = (shape[j0] * (1 - f) + (shape[Math.min(shape.length - 1, j0 + 1)] || 0) * f) * ampPx * Math.cos(strobe) * sgn / sc; }
        const nr = p.sn, nz = -p.c;
        outer.push([sign * (p.r + (p.t / 2 + d) * nr), p.z + (p.t / 2 + d) * nz]);
        inner.push([sign * (p.r + (-p.t / 2 + d) * nr), p.z + (-p.t / 2 + d) * nz]);
      }
      c.beginPath(); c.moveTo(X(outer[0][0]), Y(outer[0][1]));
      for (const q of outer) c.lineTo(X(q[0]), Y(q[1]));
      for (let i = inner.length - 1; i >= 0; i--) c.lineTo(X(inner[i][0]), Y(inner[i][1]));
      c.closePath(); c.fillStyle = BOWL ? '#b48443' : 'rgba(225,238,255,.55)'; c.fill();
      c.strokeStyle = BOWL ? '#f0cf8a' : 'rgba(240,248,255,.9)'; c.lineWidth = 0.8; c.stroke();
    };
    wall(1); wall(-1);
    // dimension labels
    c.fillStyle = 'rgba(135,148,166,.8)'; c.font = '10.5px "IBM Plex Mono", monospace'; c.textAlign = 'left';
    c.fillText(`Ø rim ${(2 * g.rimR * 1e3).toFixed(0)} mm`, 6, 14);
    c.fillText(`bowl ${(g.rim.z * 1e3).toFixed(0)} mm`, 6, 28);
    c.fillText(`${glass.mat.name.split(' (')[0]}`, 6, 42);
    if (wet) { c.textAlign = 'right'; c.fillText(`${Math.round(wet.volume * 1e6)} mL`, w - 6, 14); }
  }
  function sideFill(e) {
    if (!sideMap) return; const r = side.getBoundingClientRect(), y = e.clientY - r.top;
    const z = (sideMap.oy - y) / sideMap.sc; setFill((z - sideMap.zf) / (sideMap.zr - sideMap.zf));
  }
  side.addEventListener('pointerdown', e => { sideDrag = true; side.setPointerCapture(e.pointerId); sideFill(e); });
  side.addEventListener('pointermove', e => { if (sideDrag) sideFill(e); });
  side.addEventListener('pointerup', () => { sideDrag = false; }); side.addEventListener('pointercancel', () => { sideDrag = false; });

  // ------------------------------------------------------------ curve
  function drawCurve() {
    const cv = $('curveCv'), c = cv.getContext('2d'), w = cv.width / dpr, h = cv.height / dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!curve) { c.fillStyle = '#4d5a6b'; c.font = '12px Inter'; c.fillText('computing…', 10, 20); return; }
    const pts = curve.filter(p => isFinite(p.hz)), fmin = Math.min(...pts.map(p => p.hz)), fmax = Math.max(...pts.map(p => p.hz));
    const pad = { l: 44, r: 10, t: 8, b: 20 }, X = f => pad.l + f / 0.95 * (w - pad.l - pad.r), Y = hz => pad.t + (1 - (hz - fmin * 0.97) / (fmax * 1.01 - fmin * 0.97)) * (h - pad.t - pad.b);
    c.strokeStyle = '#1d2531'; c.lineWidth = 1; c.fillStyle = '#4d5a6b'; c.font = '10px "IBM Plex Mono", monospace';
    for (const f of [0, 0.25, 0.5, 0.75, 0.95]) { c.beginPath(); c.moveTo(X(f), pad.t); c.lineTo(X(f), h - pad.b); c.stroke(); c.textAlign = 'center'; c.fillText(Math.round(f * 100) + '%', X(f), h - 6); }
    c.textAlign = 'right'; for (const hz of [fmin, (fmin + fmax) / 2, fmax]) c.fillText(Math.round(hz), pad.l - 6, Y(hz) + 3);
    c.strokeStyle = '#3aa6d8'; c.lineWidth = 2; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p.f), Y(p.hz)) : c.moveTo(X(p.f), Y(p.hz))); c.stroke();
    if (wet) { const m = wet.modes.find(x => x.n === 2 && x.m === 0); if (m) { c.fillStyle = '#e8edf3'; c.beginPath(); c.arc(X(Math.min(0.95, S.fill)), Y(m.f), 4, 0, TAU); c.fill(); } }
  }

  // ------------------------------------------------------------ loop
  let roT = 0, lastFill = -1;
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
    strobe += TAU * 0.8 * dt;
    // velocity decays if the pointer stops producing events
    if (P.down && now - P.lastT > 40 && Math.abs(P.omega) > 1e-3) { P.omega *= Math.exp(-dt / 0.05); send({ t: 'finger', f: { theta: P.theta, omega: P.omega } }); }
    const an = analyse();
    drawTop(an, now);
    drawSide(an);
    if (S.fill !== lastFill && curve) { lastFill = S.fill; drawCurve(); }
    if (now - roT > 120 && wet) {
      roT = now;
      const m = an.dom && an.rimMax > 5e-7 ? an.dom : wet.modes.find(x => x.n === 2 && x.m === 0);
      if (m) $('roPitch').textContent = `${m.f.toFixed(1)} Hz · ${noteName(m.f)}`;
      $('roSpeed').textContent = snap && snap.down ? `${Math.abs(snap.vb * 100).toFixed(0)} cm/s` : '—';
      $('roStick').textContent = snap && snap.down ? (BOWL ? `${Math.round(snap.stick * 100)}% · ${Math.round(snap.contact * 100)}%` : `${Math.round(snap.stick * 100)}%`) : '—';
      const spl = snap ? 20 * Math.log10(Math.max(1e-7, snap.prms) / 2e-5) : 0;
      $('roLevel').textContent = snap && spl > 12 ? `${spl.toFixed(0)} dB SPL` : '—';
      document.querySelectorAll('#modeTable tbody tr').forEach(tr => tr.classList.toggle('hot', !!(an.dom && an.rimMax > 1e-6 && tr.dataset.key === an.dom.key)));
    }
    requestAnimationFrame(frame);
  }

  window.__glasshouse = { P, get rimPx() { return glass ? glass.geo.rimR * pxPerM : 0; }, get snap() { return snap; }, get audio() { return audio; }, get wet() { return wet; }, S };
  $('xlabel').textContent = `rim motion ×${EXAG}`;
  resize();
  build();
  requestAnimationFrame(frame);
})();
