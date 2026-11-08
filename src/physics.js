/*  GlassHouse — physics core
 *  ------------------------------------------------------------
 *  1. Glass bowl = thin elastic shell of revolution (Love first-approximation
 *     strains), discretised along the meridian with C1 Hermite-cubic elements
 *     for u (meridional), v (circumferential), w (normal), one Fourier order n
 *     at a time, clamped where the bowl meets the stem.
 *  2. Liquid = inviscid, incompressible potential flow inside the real bowl
 *     shape, pressure-release free surface (phi = 0; gravity/capillarity are
 *     negligible at audio frequency). Solved by Ritz minimisation of the
 *     kinetic-energy functional -> added-mass matrix in dry-mode coordinates.
 *  3. Wet modes = generalised eigenproblem K q = w^2 (M + M_fluid) q in a
 *     basis of dry modes.
 *  4. Losses per mode: material loss factor, acoustic radiation (exact 2-D
 *     cylindrical-harmonic radiation resistance applied strip-wise along the
 *     bowl height), viscous Stokes boundary layer of the liquid at the wall
 *     (from the potential-flow slip velocity), small support loss.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- linalg
  function mat(n, m) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = new Float64Array(m); return a; }

  function cholesky(A) {
    const n = A.length, L = mat(n, n);
    for (let j = 0; j < n; j++) {
      let s = A[j][j];
      const Lj = L[j];
      for (let k = 0; k < j; k++) s -= Lj[k] * Lj[k];
      if (!(s > 0)) throw new Error('matrix not SPD at ' + j + ' (' + s + ')');
      const d = Math.sqrt(s); Lj[j] = d;
      for (let i = j + 1; i < n; i++) {
        const Li = L[i]; let t = A[i][j];
        for (let k = 0; k < j; k++) t -= Li[k] * Lj[k];
        Li[j] = t / d;
      }
    }
    return L;
  }
  function fwdSub(L, b) { const n = L.length, x = new Float64Array(n); for (let i = 0; i < n; i++) { let s = b[i]; const Li = L[i]; for (let k = 0; k < i; k++) s -= Li[k] * x[k]; x[i] = s / Li[i]; } return x; }
  function bwdSubT(L, b) { const n = L.length, x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; } return x; }
  function cholSolve(L, b) { return bwdSubT(L, fwdSub(L, b)); }

  // Symmetric eigen-decomposition (Householder tridiagonalisation + implicit QL; JAMA port)
  function symEig(A) {
    const n = A.length, V = A.map(r => Float64Array.from(r)), d = new Float64Array(n), e = new Float64Array(n);
    for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
    for (let i = n - 1; i > 0; i--) {
      let scale = 0, h = 0;
      for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
      if (scale === 0) {
        e[i] = d[i - 1];
        for (let j = 0; j < i; j++) { d[j] = V[i - 1][j]; V[i][j] = 0; V[j][i] = 0; }
      } else {
        for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
        let f = d[i - 1], g = Math.sqrt(h); if (f > 0) g = -g;
        e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
        for (let j = 0; j < i; j++) e[j] = 0;
        for (let j = 0; j < i; j++) {
          f = d[j]; V[j][i] = f; g = e[j] + V[j][j] * f;
          for (let k = j + 1; k <= i - 1; k++) { g += V[k][j] * d[k]; e[k] += V[k][j] * f; }
          e[j] = g;
        }
        f = 0;
        for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
        const hh = f / (h + h);
        for (let j = 0; j < i; j++) e[j] -= hh * d[j];
        for (let j = 0; j < i; j++) {
          f = d[j]; g = e[j];
          for (let k = j; k <= i - 1; k++) V[k][j] -= (f * e[k] + g * d[k]);
          d[j] = V[i - 1][j]; V[i][j] = 0;
        }
      }
      d[i] = h;
    }
    for (let i = 0; i < n - 1; i++) {
      V[n - 1][i] = V[i][i]; V[i][i] = 1; const h = d[i + 1];
      if (h !== 0) {
        for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
        for (let j = 0; j <= i; j++) {
          let g = 0;
          for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
          for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
        }
      }
      for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
    }
    for (let j = 0; j < n; j++) { d[j] = V[n - 1][j]; V[n - 1][j] = 0; }
    V[n - 1][n - 1] = 1; e[0] = 0;
    for (let i = 1; i < n; i++) e[i - 1] = e[i];
    e[n - 1] = 0;
    let f = 0, tst1 = 0; const eps = Math.pow(2, -52);
    for (let l = 0; l < n; l++) {
      tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
      let m = l;
      while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
      if (m > l) {
        let iter = 0;
        do {
          if (++iter > 200) break;
          let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1); if (p < 0) r = -r;
          d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
          const dl1 = d[l + 1]; let h = g - d[l];
          for (let i = l + 2; i < n; i++) d[i] -= h;
          f += h;
          p = d[m]; let c = 1, c2 = c, c3 = c; const el1 = e[l + 1]; let s = 0, s2 = 0;
          for (let i = m - 1; i >= l; i--) {
            c3 = c2; c2 = c; s2 = s;
            g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
            e[i + 1] = s * r; s = e[i] / r; c = p / r; p = c * d[i] - s * g;
            d[i + 1] = h + s * (c * g + s * d[i]);
            for (let k = 0; k < n; k++) { h = V[k][i + 1]; V[k][i + 1] = s * V[k][i] + c * h; V[k][i] = c * V[k][i] - s * h; }
          }
          p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p;
        } while (Math.abs(e[l]) > eps * tst1);
      }
      d[l] = d[l] + f; e[l] = 0;
    }
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[a] - d[b]);
    return { values: idx.map(i => d[i]), vectors: idx.map(i => { const v = new Float64Array(n); for (let k = 0; k < n; k++) v[k] = V[k][i]; return v; }) };
  }

  // Generalised symmetric-definite eigenproblem K x = lambda M x, x^T M x = 1
  function genEig(K, M, nKeep) {
    const n = K.length, L = cholesky(M);
    const X = mat(n, n);                              // X = L^-1 K   (column by column)
    const col = new Float64Array(n);
    for (let j = 0; j < n; j++) { for (let i = 0; i < n; i++) col[i] = K[i][j]; const y = fwdSub(L, col); for (let i = 0; i < n; i++) X[i][j] = y[i]; }
    const C = mat(n, n);                              // C = L^-1 X^T
    for (let j = 0; j < n; j++) { for (let i = 0; i < n; i++) col[i] = X[j][i]; const y = fwdSub(L, col); for (let i = 0; i < n; i++) C[i][j] = y[i]; }
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const a = 0.5 * (C[i][j] + C[j][i]); C[i][j] = a; C[j][i] = a; }
    const { values, vectors } = symEig(C);
    const k = Math.min(nKeep || n, n), out = [];
    for (let i = 0; i < k; i++) out.push({ lambda: values[i], x: bwdSubT(L, vectors[i]) });
    return out;
  }

  // -------------------------------------------------------------- quadrature
  const GL = (function () {
    function rule(n) {                                // Gauss-Legendre on [-1,1]
      const x = new Float64Array(n), w = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), pp = 0;
        for (let it = 0; it < 100; it++) {
          let p1 = 1, p2 = 0;
          for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
          pp = n * (z * p1 - p2) / (z * z - 1);
          const z1 = z; z = z1 - p1 / pp; if (Math.abs(z - z1) < 1e-15) break;
        }
        x[i] = z; w[i] = 2 / ((1 - z * z) * pp * pp);
      }
      return { x, w };
    }
    const c = {}; return n => c[n] || (c[n] = rule(n));
  })();

  // Legendre P_0..P_{N-1} and derivatives at X
  function legendre(N, X, P, dP) {
    P[0] = 1; dP[0] = 0; if (N > 1) { P[1] = X; dP[1] = 1; }
    for (let k = 2; k < N; k++) { P[k] = ((2 * k - 1) * X * P[k - 1] - (k - 1) * P[k - 2]) / k; dP[k] = dP[k - 2] + (2 * k - 1) * P[k - 1]; }
  }

  // ----------------------------------------------------------------- Bessel
  const EULER = 0.5772156649015329;
  function besselJ(n, x) { let s = 0, t = Math.pow(x / 2, n); for (let k = 1; k <= n; k++) t /= k; for (let k = 0; k < 80; k++) { s += t; t *= -(x * x / 4) / ((k + 1) * (k + 1 + n)); if (Math.abs(t) < 1e-18 * Math.abs(s)) break; } return s; }
  function besselY(n, x) {                            // A&S 9.1.11, integer n >= 0
    const h = x / 2; let s1 = 0;
    if (n > 0) { const fact = [1]; for (let i = 1; i <= n; i++) fact[i] = fact[i - 1] * i; for (let k = 0; k < n; k++) s1 += fact[n - k - 1] / fact[k] * Math.pow(h * h, k); s1 *= -Math.pow(h, -n) / Math.PI; }
    const s2 = 2 / Math.PI * Math.log(h) * besselJ(n, x);
    let psiK = -EULER, psiNK = -EULER; for (let i = 1; i <= n; i++) psiNK += 1 / i;
    let t = Math.pow(h, n); for (let i = 1; i <= n; i++) t /= i;          // (h^n)/(0! n!)
    let s3 = 0;
    for (let k = 0; k < 80; k++) {
      s3 += (psiK + psiNK) * t;
      t *= -(h * h) / ((k + 1) * (n + k + 1)); psiK += 1 / (k + 1); psiNK += 1 / (n + k + 1);
      if (Math.abs(t) < 1e-18) break;
    }
    return s1 + s2 - s3 / Math.PI;
  }
  // Real part of the specific radiation impedance of a cylinder vibrating as cos(n theta):
  //   z_n = i rho c H_n(ka)/H_n'(ka);  Re z_n = rho c * (2/(pi ka)) / |H_n'(ka)|^2  (Wronskian)
  function radResistance(n, x, rhoC) {
    const dJ = n === 0 ? -besselJ(1, x) : 0.5 * (besselJ(n - 1, x) - besselJ(n + 1, x));
    const dY = n === 0 ? -besselY(1, x) : 0.5 * (besselY(n - 1, x) - besselY(n + 1, x));
    return rhoC * (2 / (Math.PI * x)) / (dJ * dJ + dY * dY);
  }

  // --------------------------------------------------------------- geometry
  // Midsurface meridian = cubic Bezier in (r, z) [mm], P0 at stem junction.
  function makeGeometry(P, scale, tRim, tBase) {
    const S = scale * 1e-3;
    const p = P.map(q => [q[0] * S, q[1] * S]);
    function bz(t) {
      const u = 1 - t;
      const r = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
      const z = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
      const d1 = (a, b) => 3 * (u * u * (p[1][a] - p[0][a]) + 2 * u * t * (p[2][a] - p[1][a]) + t * t * (p[3][a] - p[2][a]));
      const d2 = a => 6 * (u * (p[2][a] - 2 * p[1][a] + p[0][a]) + t * (p[3][a] - 2 * p[2][a] + p[1][a]));
      const d3 = a => 6 * (p[3][a] - 3 * p[2][a] + 3 * p[1][a] - p[0][a]);
      return { r, z, rt: d1(0), zt: d1(1), rtt: d2(0), ztt: d2(1), rttt: d3(0), zttt: d3(1) };
    }
    const NT = 4000, Ts = new Float64Array(NT + 1), Ss = new Float64Array(NT + 1);
    let prev = Math.hypot(bz(0).rt, bz(0).zt);
    for (let i = 1; i <= NT; i++) {                   // Simpson per sub-interval
      const t0 = (i - 1) / NT, t1 = i / NT, tm = 0.5 * (t0 + t1);
      const bm = bz(tm), b1 = bz(t1), sm = Math.hypot(bm.rt, bm.zt), s1 = Math.hypot(b1.rt, b1.zt);
      Ss[i] = Ss[i - 1] + (t1 - t0) * (prev + 4 * sm + s1) / 6; Ts[i] = t1; prev = s1;
    }
    const L = Ss[NT];
    function tOfS(s) {
      if (s <= 0) return 0; if (s >= L) return 1;
      let lo = 0, hi = NT; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Ss[m] < s) lo = m; else hi = m; }
      let t = Ts[lo] + (s - Ss[lo]) / (Ss[hi] - Ss[lo]) * (Ts[hi] - Ts[lo]);
      const b = bz(t); t += 0; return t;
    }
    function thick(s) { const x = 1 - s / L; return tRim + (tBase - tRim) * x * x; }
    function at(s) {
      const b = bz(tOfS(s));
      const sig = Math.hypot(b.rt, b.zt), c = b.rt / sig, sn = b.zt / sig;
      const N = b.rt * b.ztt - b.zt * b.rtt, Nt = b.rt * b.zttt - b.zt * b.rttt;
      const sigt = (b.rt * b.rtt + b.zt * b.ztt) / sig;
      const k1 = N / (sig * sig * sig);
      const dk1 = (Nt / (sig * sig * sig) - 3 * N * sigt / (sig * sig * sig * sig)) / sig;
      const k2 = sn / b.r, dk2 = c * (k1 - k2) / b.r;
      return { r: b.r, z: b.z, c, sn, k1, dk1, k2, dk2, t: thick(s) };
    }
    // inner (liquid-side) surface table, z made monotone
    const NI = 800, inner = { s: new Float64Array(NI + 1), r: new Float64Array(NI + 1), z: new Float64Array(NI + 1) };
    for (let i = 0; i <= NI; i++) {
      const s = L * i / NI, g = at(s);
      inner.s[i] = s; inner.r[i] = g.r - 0.5 * g.t * g.sn; inner.z[i] = g.z + 0.5 * g.t * g.c;
      if (i > 0 && inner.z[i] <= inner.z[i - 1]) inner.z[i] = inner.z[i - 1] + 1e-9;
    }
    function innerAtZ(zq) {                           // returns {r, s}
      const Z = inner.z; if (zq <= Z[0]) return { r: inner.r[0], s: 0 };
      if (zq >= Z[NI]) return { r: inner.r[NI], s: L };
      let lo = 0, hi = NI; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Z[m] < zq) lo = m; else hi = m; }
      const f = (zq - Z[lo]) / (Z[hi] - Z[lo]);
      return { r: inner.r[lo] + f * (inner.r[hi] - inner.r[lo]), s: inner.s[lo] + f * (inner.s[hi] - inner.s[lo]) };
    }
    let rMaxOuter = 0; for (let i = 0; i <= 200; i++) { const g = at(L * i / 200); rMaxOuter = Math.max(rMaxOuter, g.r + 0.5 * g.t * g.sn); }
    const rim = at(L);
    return { L, at, thick, inner, innerAtZ, zFloor: inner.z[0], zRimIn: inner.z[NI], rim, rimR: rim.r, rMaxOuter, profileT: bz };
  }

  // -------------------------------------------------------- shell FE (order n)
  function hermite(x, h, N, dN, ddN) {
    const x2 = x * x, x3 = x2 * x;
    N[0] = 1 - 3 * x2 + 2 * x3; N[1] = h * (x - 2 * x2 + x3); N[2] = 3 * x2 - 2 * x3; N[3] = h * (x3 - x2);
    dN[0] = (-6 * x + 6 * x2) / h; dN[1] = (1 - 4 * x + 3 * x2); dN[2] = (6 * x - 6 * x2) / h; dN[3] = (3 * x2 - 2 * x);
    ddN[0] = (-6 + 12 * x) / (h * h); ddN[1] = (-4 + 6 * x) / h; ddN[2] = (6 - 12 * x) / (h * h); ddN[3] = (6 * x - 2) / h;
  }
  const FIELD_OFF = { U: 0, V: 2, W: 4 };
  const LOC = f => [FIELD_OFF[f], FIELD_OFF[f] + 1, 6 + FIELD_OFF[f], 6 + FIELD_OFF[f] + 1];
  const LU = LOC('U'), LV = LOC('V'), LW = LOC('W');

  function shellModes(geo, matl, n, opts) {
    opts = opts || {};
    const Ne = opts.Ne || 36, nKeep = opts.nKeep || 8, clamp = opts.clamp !== false;
    const L = geo.L, nodes = new Float64Array(Ne + 1);
    for (let i = 0; i <= Ne; i++) { const x = i / Ne; nodes[i] = L * (0.6 * x + 0.4 * x * x); } // finer near the clamp
    const nd = 6 * (Ne + 1), K = mat(nd, nd), M = mat(nd, nd);
    const E = matl.E, nu = matl.nu, rho = matl.rho, q = GL(5);
    const N = new Float64Array(4), dN = new Float64Array(4), ddN = new Float64Array(4);
    const rows = Array.from({ length: 9 }, () => new Float64Array(12)); // e1 e2 g k1 k2 tw | U V W
    for (let e = 0; e < Ne; e++) {
      const sa = nodes[e], h = nodes[e + 1] - sa, base = 6 * e;
      for (let iq = 0; iq < q.x.length; iq++) {
        const x = 0.5 * (q.x[iq] + 1), wq = 0.5 * q.w[iq] * h, s = sa + x * h, g = geo.at(s);
        hermite(x, h, N, dN, ddN);
        for (const r of rows) r.fill(0);
        const [e1, e2, gm, kb1, kb2, tw, mU, mV, mW] = rows;
        const r = g.r, c = g.c, k1 = g.k1, k2 = g.k2, dk1 = g.dk1, dk2 = g.dk2;
        for (let a = 0; a < 4; a++) {
          const iu = LU[a], iv = LV[a], iw = LW[a];
          const U = N[a], Up = dN[a], V = N[a], Vp = dN[a], W = N[a], Wp = dN[a], Wpp = ddN[a];
          // contributions of U-dof
          e1[iu] += Up; e2[iu] += c * U / r; gm[iu] += -n * U / r;
          { const B1 = k1 * U, B1p = dk1 * U + k1 * Up; kb1[iu] += B1p; kb2[iu] += c * B1 / r; tw[iu] += -n * B1 / r; }
          mU[iu] += U;
          // V-dof
          e2[iv] += n * V / r; gm[iv] += Vp - c * V / r;
          { const B2 = k2 * V, B2p = dk2 * V + k2 * Vp; kb2[iv] += n * B2 / r; tw[iv] += B2p - c * B2 / r; }
          mV[iv] += V;
          // W-dof
          e1[iw] += k1 * W; e2[iw] += k2 * W;
          { const B1 = -Wp, B1p = -Wpp, B2 = n * W / r, B2p = n * (Wp / r - c * W / (r * r));
            kb1[iw] += B1p; kb2[iw] += (n * B2 + c * B1) / r; tw[iw] += B2p - c * B2 / r - n * B1 / r; }
          mW[iw] += W;
        }
        const t = g.t, Cm = E * t / (1 - nu * nu), Db = E * t * t * t / (12 * (1 - nu * nu));
        const dA = Math.PI * r * wq, mu = rho * t * dA, G = 0.5 * (1 - nu);
        for (let i = 0; i < 12; i++) {
          const Ki = K[base + i], Mi = M[base + i];
          for (let j = 0; j < 12; j++) {
            Ki[base + j] += dA * (Cm * (e1[i] * e1[j] + e2[i] * e2[j] + nu * (e1[i] * e2[j] + e2[i] * e1[j]) + G * gm[i] * gm[j])
                                + Db * (kb1[i] * kb1[j] + kb2[i] * kb2[j] + nu * (kb1[i] * kb2[j] + kb2[i] * kb1[j]) + G * tw[i] * tw[j]));
            Mi[base + j] += mu * (mU[i] * mU[j] + mV[i] * mV[j] + mW[i] * mW[j]);
          }
        }
      }
    }
    const fixed = new Set(clamp ? [0, 2, 4, 5] : []);
    const free = []; for (let i = 0; i < nd; i++) if (!fixed.has(i)) free.push(i);
    const Kr = mat(free.length, free.length), Mr = mat(free.length, free.length);
    for (let i = 0; i < free.length; i++) for (let j = 0; j < free.length; j++) { Kr[i][j] = K[free[i]][free[j]]; Mr[i][j] = M[free[i]][free[j]]; }
    const sol = genEig(Kr, Mr, nKeep);
    return sol.map(m => {
      const x = new Float64Array(nd); free.forEach((gi, i) => x[gi] = m.x[i]);
      return { n, omega: Math.sqrt(Math.max(m.lambda, 0)), x, nodes };
    });
  }

  // evaluate a mode's fields at arclength s
  function modeAt(mode, s, out) {
    const nodes = mode.nodes, Ne = nodes.length - 1;
    let e = 0, lo = 0, hi = Ne; if (s >= nodes[Ne]) e = Ne - 1; else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (nodes[m] <= s) lo = m; else hi = m; } e = lo; }
    const h = nodes[e + 1] - nodes[e], x = Math.min(1, Math.max(0, (s - nodes[e]) / h));
    const N = _N, dN = _dN, ddN = _ddN; hermite(x, h, N, dN, ddN);
    const b = 6 * e, X = mode.x; out = out || {};
    const f = (off, arr) => arr[0] * X[b + off] + arr[1] * X[b + off + 1] + arr[2] * X[b + 6 + off] + arr[3] * X[b + 6 + off + 1];
    out.U = f(0, N); out.Up = f(0, dN); out.V = f(2, N); out.Vp = f(2, dN); out.W = f(4, N); out.Wp = f(4, dN);
    return out;
  }
  const _N = new Float64Array(4), _dN = new Float64Array(4), _ddN = new Float64Array(4);

  // ---------------------------------------------------------- liquid (Ritz)
  function liquidCoupling(geo, n, dry, hLevel, opts) {
    opts = opts || {};
    const zf = geo.zFloor, H = hLevel - zf;
    if (H < 1e-4) return null;
    const Np = opts.Np || 6, Nq = opts.Nq || 6, Nb = Np * Nq;
    const top = geo.innerAtZ(hLevel), sH = top.s;
    let Rs = top.r; for (let i = 0; i <= 40; i++) Rs = Math.max(Rs, geo.innerAtZ(zf + H * i / 40).r);
    const Pp = new Float64Array(Np), dPp = new Float64Array(Np), Pq = new Float64Array(Nq), dPq = new Float64Array(Nq);
    const phi = new Float64Array(Nb), phR = new Float64Array(Nb), phZ = new Float64Array(Nb), phOr = new Float64Array(Nb);
    function basis(r, z) {
      const rho = r / Rs, X = 2 * rho * rho - 1, zh = Math.max(0, (z - zf) / H), Y = 2 * zh - 1, hz = hLevel - z;
      legendre(Np, X, Pp, dPp); legendre(Nq, Y, Pq, dPq);
      const rn = Math.pow(rho, n), rn1 = n > 0 ? Math.pow(rho, n - 1) : 0;
      for (let p = 0; p < Np; p++) for (let qq = 0; qq < Nq; qq++) {
        const k = p * Nq + qq, PP = Pp[p], PQ = Pq[qq];
        phi[k] = hz * rn * PP * PQ;
        phOr[k] = hz * rn1 / Rs * PP * PQ;                       // phi / r
        phR[k] = hz * PQ * (n * rn1 / Rs * PP + rn * dPp[p] * 4 * rho / Rs);
        phZ[k] = rn * PP * (-PQ + hz * dPq[qq] * 2 / H);
      }
    }
    // stiffness-like matrix A = pi * int (grad phi_k . grad phi_l) r dr dz
    const A = mat(Nb, Nb), qz = GL(4), qr = GL(16), NZ = 14;
    let vol = 0;
    for (let iz = 0; iz < NZ; iz++) for (let a = 0; a < qz.x.length; a++) {
      const u = (iz + 0.5 * (qz.x[a] + 1)) / NZ, wu = 0.5 * qz.w[a] / NZ;
      const z = zf + H * u * u, wz = wu * 2 * H * u, R = geo.innerAtZ(z).r;
      vol += Math.PI * R * R * wz;
      for (let b = 0; b < qr.x.length; b++) {
        const r = 0.5 * R * (qr.x[b] + 1), w = Math.PI * wz * 0.5 * R * qr.w[b] * r;
        basis(r, z);
        for (let k = 0; k < Nb; k++) {
          const ak = phR[k] * w, bk = phZ[k] * w, ck = n * n * phOr[k] * w, Ak = A[k];
          for (let l = 0; l <= k; l++) Ak[l] += ak * phR[l] + bk * phZ[l] + ck * phOr[l];
        }
      }
    }
    let tr = 0; for (let k = 0; k < Nb; k++) { for (let l = 0; l < k; l++) A[l][k] = A[k][l]; tr += A[k][k]; }
    for (let k = 0; k < Nb; k++) A[k][k] += 1e-11 * tr / Nb;
    const LA = cholesky(A);
    // wall integrals over the wetted inner surface
    const nm = dry.length, qs = GL(4), NS = 36, wall = [];
    const bvec = Array.from({ length: nm }, () => new Float64Array(Nb)), fld = {};
    for (let is = 0; is < NS; is++) for (let a = 0; a < qs.x.length; a++) {
      const s = sH * (is + 0.5 * (qs.x[a] + 1)) / NS, ws = sH * 0.5 * qs.w[a] / NS, g = geo.at(s);
      const r = g.r - 0.5 * g.t * g.sn, z = Math.min(hLevel, g.z + 0.5 * g.t * g.c);
      basis(r, z);
      const pt = { w: ws, r, phi: Float64Array.from(phi), dphiT: new Float64Array(Nb), phOr: Float64Array.from(phOr), U: new Float64Array(nm), V: new Float64Array(nm) };
      for (let k = 0; k < Nb; k++) pt.dphiT[k] = phR[k] * g.c + phZ[k] * g.sn;
      for (let m = 0; m < nm; m++) {
        modeAt(dry[m], s, fld); pt.U[m] = fld.U; pt.V[m] = fld.V;
        const f = Math.PI * ws * fld.W * r, bm = bvec[m];
        for (let k = 0; k < Nb; k++) bm[k] += f * phi[k];
      }
      wall.push(pt);
    }
    const cvec = bvec.map(b => cholSolve(LA, b));
    const Mf = mat(nm, nm);
    for (let i = 0; i < nm; i++) for (let j = 0; j < nm; j++) { let s = 0; for (let k = 0; k < Nb; k++) s += bvec[i][k] * cvec[j][k]; Mf[i][j] = s; }
    for (let i = 0; i < nm; i++) for (let j = 0; j < i; j++) { const a = 0.5 * (Mf[i][j] + Mf[j][i]); Mf[i][j] = a; Mf[j][i] = a; }
    // slip-velocity fields (fluid tangential velocity minus wall velocity) per dry mode at wall points
    for (const pt of wall) {
      pt.fs = new Float64Array(nm); pt.ft = new Float64Array(nm);
      for (let m = 0; m < nm; m++) {
        let a = 0, b = 0; const c = cvec[m];
        for (let k = 0; k < Nb; k++) { a += c[k] * pt.dphiT[k]; b += c[k] * pt.phOr[k]; }
        pt.fs[m] = a - pt.U[m]; pt.ft[m] = -n * b - pt.V[m];
      }
      delete pt.phi; delete pt.dphiT; delete pt.phOr;
    }
    return { Mf, wall, sH, vol };
  }

  // ------------------------------------------------------------- materials
  const MATERIALS = {
    leadCrystal: { name: 'Lead crystal (24–30% PbO)', E: 58e9, rho: 3050, nu: 0.23, eta: 2.5e-4 },
    sodaLime: { name: 'Soda-lime glass', E: 72e9, rho: 2500, nu: 0.22, eta: 1.0e-3 },
    borosilicate: { name: 'Borosilicate', E: 64e9, rho: 2230, nu: 0.20, eta: 5.0e-4 },
    fusedQuartz: { name: 'Fused quartz', E: 72.5e9, rho: 2200, nu: 0.17, eta: 4.0e-6 },
  };
  const SHAPES = {
    bordeaux: { name: 'Bordeaux', P: [[4.5, 0], [42, 0], [52, 62], [36, 102]] },
    burgundy: { name: 'Burgundy balloon', P: [[4.5, 0], [58, 0], [64, 70], [40, 100]] },
    tulip: { name: 'Tulip (flared rim)', P: [[4.5, 0], [40, 0], [26, 70], [38, 108]] },
    snifter: { name: 'Brandy snifter', P: [[4.5, 0], [62, 0], [70, 78], [31, 102]] },
    flute: { name: 'Champagne flute', P: [[3.5, 0], [18, 0], [27, 85], [25, 165]] },
  };
  const AIR = { rho: 1.204, c: 343.2 };
  const WATER = { rho: 998, nu: 1.0e-6 };

  // ----------------------------------------------------------- top level
  // Build dry modal model of the glass (expensive; on shape/material change)
  function buildGlass(cfg) {
    const shape = SHAPES[cfg.shape] || SHAPES.bordeaux, m = MATERIALS[cfg.material] || MATERIALS.leadCrystal;
    const tRim = cfg.tRim || 1.2e-3, tBase = tRim * (cfg.baseRatio || 2.4);
    const geo = makeGeometry(shape.P, cfg.scale || 1, tRim, tBase);
    const orders = cfg.orders || [2, 3, 4, 5, 6], byN = {};
    for (const n of orders) byN[n] = shellModes(geo, m, n, { Ne: cfg.Ne || 36, nKeep: cfg.nKeep || 8 });
    return { cfg, geo, mat: m, shape, byN, orders };
  }

  // Wet modes + losses for a fill fraction (cheap; live while dragging)
  function wetModes(glass, fill, opts) {
    opts = opts || {};
    const { geo, mat: m } = glass, fmax = opts.fmax || 15000, perN = opts.perN || 3, listenerR = opts.listenerR || 0.5;
    const h = geo.zFloor + fill * (geo.zRimIn - geo.zFloor);
    const out = []; let vol = 0, sH = 0;
    const qs = GL(4), NS = 30, fld = {};
    for (const n of glass.orders) {
      const dry = glass.byN[n], nm = dry.length;
      const liq = fill > 0.003 ? liquidCoupling(geo, n, dry, h) : null;
      if (liq) { vol = liq.vol; sH = liq.sH; }
      let modes;
      if (liq) {
        const Kr = mat(nm, nm), Mr = mat(nm, nm);
        for (let i = 0; i < nm; i++) { Kr[i][i] = dry[i].omega * dry[i].omega; for (let j = 0; j < nm; j++) Mr[i][j] = (i === j ? 1 : 0) + WATER.rho * liq.Mf[i][j]; }
        modes = genEig(Kr, Mr, nm).map(s => ({ omega: Math.sqrt(s.lambda), X: s.x }));
      } else modes = dry.map((d, i) => { const X = new Float64Array(nm); X[i] = 1; return { omega: d.omega, X }; });
      const dryOmega = dry.map(d => d.omega);
      let count = 0;
      for (let j = 0; j < modes.length && count < perN; j++) {
        const { omega, X } = modes[j], f = omega / (2 * Math.PI);
        if (f > fmax) break;
        // fields of the wet mode at rim, waterline; radiation integral over outer surface
        const comb = s => { let U = 0, V = 0, W = 0; for (let i = 0; i < nm; i++) { modeAt(dry[i], s, fld); U += X[i] * fld.U; V += X[i] * fld.V; W += X[i] * fld.W; } return { U, V, W }; };
        const rim = comb(geo.L), gR = geo.rim;
        const rimR = rim.U * gR.c + rim.W * gR.sn, rimA = rim.U * gR.sn - rim.W * gR.c;
        const kAir = omega / AIR.c;
        let cRad = 0;
        for (let is = 0; is < NS; is++) for (let a = 0; a < qs.x.length; a++) {
          const s = geo.L * (is + 0.5 * (qs.x[a] + 1)) / NS, ws = geo.L * 0.5 * qs.w[a] / NS, g = geo.at(s), F = comb(s);
          const ro = g.r + 0.5 * g.t * g.sn, vr = F.W * g.sn + F.U * g.c;
          cRad += Math.PI * ws * radResistance(n, kAir * ro, AIR.rho * AIR.c) * vr * vr * ro * g.sn; // strip of height ds*sin(psi)
        }
        let cVis = 0;
        if (liq) {
          let I = 0;
          for (const pt of liq.wall) { let ds = 0, dt = 0; for (let i = 0; i < nm; i++) { ds += X[i] * pt.fs[i]; dt += X[i] * pt.ft[i]; } I += Math.PI * pt.w * (ds * ds + dt * dt) * pt.r; }
          cVis = WATER.rho * Math.sqrt(WATER.nu * omega / 2) * I;
        }
        let wl = 0; if (liq) { const F = comb(sH), g = geo.at(sH); wl = F.W * g.sn + F.U * g.c; }
        let shape = null;
        if (opts.shapes) { const NSH = 48; shape = new Float32Array(NSH + 1); for (let i = 0; i <= NSH; i++) { const F = comb(geo.L * i / NSH); shape[i] = F.W; } }
        const zMat = m.eta / 2, zRad = cRad / (2 * omega), zVis = cVis / (2 * omega), zSup = 1.5e-5;
        const zeta = zMat + zRad + zVis + zSup;
        out.push({
          key: n + ':' + j, n, m: j, f, omega, fDry: dryOmega[j] / (2 * Math.PI),
          zeta, Q: 1 / (2 * zeta), zMat, zRad, zVis, zSup,
          rimV: rim.V, rimR, rimA, wl, shape,
          G: Math.sqrt(2 * AIR.rho * AIR.c * cRad / (4 * Math.PI * listenerR * listenerR)),
        });
        count++;
      }
    }
    return { modes: out.sort((a, b) => a.f - b.f), h, volume: vol, sH, fill };
  }

  // quick profile sampler for drawing (mm)
  function profile(glass, N) {
    const g = glass.geo, pts = [];
    for (let i = 0; i <= N; i++) { const s = g.L * i / N, a = g.at(s); pts.push({ r: a.r, z: a.z, t: a.t, c: a.c, sn: a.sn }); }
    return pts;
  }

  const api = { buildGlass, wetModes, profile, MATERIALS, SHAPES, AIR, WATER, _t: { makeGeometry, shellModes, liquidCoupling, besselJ, besselY, radResistance, genEig, symEig, modeAt, cholesky, cholSolve, GL } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GlassPhysics = api;
})(typeof self !== 'undefined' ? self : this);
