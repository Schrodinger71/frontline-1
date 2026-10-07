'use strict';
/* Графика штабного экрана в духе «Ночного рубежа»: топооснова, плашки, атмосфера. */

const PX = 2, GRID = 10;
let TER = null, GRAIN = null, ANIM = 0, SHAKE = 0;

function h2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, o) {
  let t = 0, a = .5, f = 1, n = 0;
  for (let i = 0; i < o; i++) { t += a * vnoise(x * f, y * f, s + i * 31); n += a; a *= .5; f *= 2.03 }
  return t / n;
}

function bendy(a, b, n, amp, seed) {
  const L = dist(a, b) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L, pts = [];
  for (let q = 0; q <= n; q++) {
    const t = q / n, j = (fbm(t * 4, seed, seed, 4) - .5) * 2 * amp * Math.sin(Math.PI * t);
    pts.push({ x: a.x + (b.x - a.x) * t + nx * j, y: a.y + (b.y - a.y) * t + ny * j });
  }
  return pts;
}

function riverPath(x0, y0, tx, ty, s) {
  const pts = [{ x: x0, y: y0 }];
  let x = x0, y = y0;
  for (let i = 0; i < 500; i++) {
    const a = Math.atan2(ty - y, tx - x) + (fbm(x * .03, y * .03, s, 4) - .5) * 2.1;
    x += Math.cos(a) * 1.6; y += Math.sin(a) * 1.6;
    pts.push({ x, y });
    if (Math.hypot(tx - x, ty - y) < 3 || x < -4 || x > WW + 4) break;
  }
  return pts;
}

const MAP = { rivers: [], roads: [], villages: [] };

function bakeTerrain() {
  const w = WW * PX, h = WH * PX;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h), D = img.data;
  const H = new Float32Array(w * h), F = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = (j + .5) / PX;
    for (let i = 0; i < w; i++) {
      const x = (i + .5) / PX, k = j * w + i;
      H[k] = fbm(x * .018, y * .018, 7, 5);
      F[k] = fbm(x * .055, y * .055, 31, 3) + (1 - y / WH) * .05 + H[k] * .12;
    }
  }
  const FLD = [[38, 45, 34], [44, 49, 34], [34, 42, 32], [48, 48, 36], [40, 45, 30], [35, 41, 29]];
  for (let j = 0; j < h; j++) {
    const y = (j + .5) / PX;
    for (let i = 0; i < w; i++) {
      const x = (i + .5) / PX, k = j * w + i;
      let r, gg, b;
      if (F[k] > .61) { r = 20; gg = 36; b = 25 }
      else {
        const rx = x * .95 + y * .31, ry = -x * .31 + y * .95;
        const f = FLD[(h2(Math.floor(rx / 2.3), Math.floor(ry / 1.7), 5) * FLD.length) | 0];
        r = f[0]; gg = f[1]; b = f[2];
      }
      const hl = H[k - 1] || H[k], hr = H[k + 1] || H[k], hu = H[k - w] || H[k], hd = H[k + w] || H[k];
      const sh = clamp(1 + (hl - hr + hu - hd) * 26, .7, 1.32), el = .88 + H[k] * .28;
      r *= sh * el; gg *= sh * el; b *= sh * el;
      const o = k * 4; D[o] = r; D[o + 1] = gg; D[o + 2] = b; D[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.scale(PX, PX); g.lineJoin = 'round'; g.lineCap = 'round';

  MAP.rivers = [
    { n: 'Тихая', w: 1.35, pts: riverPath(172, -8, 188, 450, 11) },
    { n: 'Каменка', w: .7, pts: riverPath(40, 268, 175, 210, 19) }
  ];
  const cities = POINT_DEF.filter(p => p.city);
  MAP.roads = [];
  const links = [[0, 4], [1, 3], [2, 4], [4, 6], [6, 10], [10, 12], [11, 12], [5, 8], [8, 11], [7, 10], [7, 13], [13, 12], [2, 7]];
  const all = POINT_DEF;
  for (const [ia, ib] of links) {
    if (!all[ia] || !all[ib]) continue;
    MAP.roads.push({ main: all[ia].city && all[ib].city, pts: bendy(all[ia], all[ib], 10, 7, ia * 13 + ib) });
  }
  MAP.roads.push({ main: 1, pts: bendy({ x: 118, y: 20 }, { x: 132, y: 420 }, 16, 9, 3) });

  /* города — чёткие кварталы (прямоугольники построек), а не размытые пятна */
  const rndCity = mulberry(77);
  for (const c of cities) {
    const n = 10 + c.w * 9, R = c.w * 2.2 + 1;
    for (let i = 0; i < n; i++) {
      const a = rndCity() * 6.283, rr2 = R * Math.sqrt(rndCity());
      const bx = c.x + Math.cos(a) * rr2, by = c.y + Math.sin(a) * rr2;
      const bw = .9 + rndCity() * 1.3, bh = .7 + rndCity() * 1.1;
      g.save(); g.translate(bx, by); g.rotate(rndCity() * 6.283);
      g.fillStyle = c.owner === S ? 'rgba(98,68,58,.82)' : 'rgba(84,80,70,.86)';
      g.fillRect(-bw / 2, -bh / 2, bw, bh);
      g.strokeStyle = 'rgba(18,16,13,.55)'; g.lineWidth = .12; g.strokeRect(-bw / 2, -bh / 2, bw, bh);
      g.restore();
    }
  }
  const rnd = mulberry(21);
  MAP.villages = [];
  for (let i = 0; i < 28; i++) {
    const v = { x: 20 + rnd() * 260, y: 20 + rnd() * 400, s: .8 + rnd() * 1.4 };
    MAP.villages.push(v);
    g.fillStyle = 'rgba(80,74,58,.66)';
    g.fillRect(v.x - v.s / 2, v.y - v.s / 2, v.s, v.s);
  }

  for (const r of MAP.roads) {
    g.strokeStyle = r.main ? 'rgba(122,106,74,.85)' : 'rgba(92,84,62,.7)';
    g.lineWidth = r.main ? .62 : .4;
    g.beginPath(); r.pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
  }
  for (const r of MAP.rivers) {
    g.strokeStyle = '#10313f'; g.lineWidth = r.w + .55;
    g.beginPath(); r.pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
    g.strokeStyle = '#1d4c68'; g.lineWidth = r.w * .6; g.stroke();
  }
  g.strokeStyle = 'rgba(190,178,150,.8)'; g.lineWidth = .75;
  g.beginPath(); g.moveTo(152, 167.2); g.lineTo(156, 168.8); g.stroke();

  TER = c;
}

/* плоские командные цвета по сторонам — как маркеры на тактической карте, без градиентов */
const PAL_OWN = { b: '#5b9bd0', s: '#3d6f93', l: '#d7ecf7', d: '#172732', g: '#9fd8e8', a: '#f2b33d' };
const PAL_EN = { b: '#d2654f', s: '#8f3a2b', l: '#f7d9cd', d: '#2c130b', g: '#e8a98f', a: '#f2b33d' };

function tint(hex, k) {
  const n = parseInt(String(hex).slice(1, 7), 16);
  if (!Number.isFinite(n)) return hex;
  const r = n >> 16 & 255, gg = n >> 8 & 255, b = n & 255;
  const f = c => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(r)},${f(gg)},${f(b)})`;
}
/** путь + плоская заливка с тонкой тёмной обводкой по краю — читается на любом фоне */
function flat(g, fillCol, buildPath) {
  buildPath(); g.strokeStyle = 'rgba(6,8,6,.7)'; g.lineWidth = 2.4; g.stroke();
  buildPath(); g.fillStyle = fillCol; g.fill();
}

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function drawPlate(g, x, y, w, h, col, sel) {
  const r = Math.min(h * .32, 10);
  rr(g, x - w / 2, y - h / 2, w, h, r);
  const gr = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  gr.addColorStop(0, 'rgba(24,34,42,.92)');
  gr.addColorStop(1, 'rgba(8,13,18,.92)');
  g.fillStyle = gr; g.fill();
  g.lineWidth = sel ? 2.2 : 1.3;
  g.strokeStyle = sel ? '#f2b33d' : col;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x - w / 2 + r, y - h / 2 + 1.5); g.lineTo(x + w / 2 - r, y - h / 2 + 1.5); g.stroke();
}

function sil(g, k, pal) {
  g.lineJoin = 'round'; g.lineCap = 'round';
  const fill = (c, fn) => { g.fillStyle = c; fn(); g.fill() };
  const st = (c, w, fn) => { g.strokeStyle = c; g.lineWidth = w; fn(); g.stroke() };
  g.save();
  g.translate(8, 8); g.scale(1.04, 1.04);

  if (k === 'tnk') {
    flat(g, pal.d, () => { rr(g, 8, 38, 108, 11, 5); }); /* гусеницы */
    flat(g, pal.b, () => { g.beginPath();
      g.moveTo(16, 38); g.lineTo(20, 24); g.lineTo(32, 18); g.lineTo(94, 18); g.lineTo(108, 26); g.lineTo(110, 38); g.closePath(); });
    flat(g, pal.s, () => { rr(g, 42, 9, 38, 17, 4); });
    fill(pal.d, () => { rr(g, 76, 14, 44, 6, 2); });
    fill(pal.a, () => { g.beginPath(); g.arc(54, 14, 2.8, 0, 7); });
  }

  else if (k === 'art') {
    flat(g, pal.d, () => { rr(g, 14, 40, 76, 10, 4); });
    flat(g, pal.b, () => { rr(g, 20, 22, 44, 18, 3); });
    fill(pal.s, () => { g.beginPath(); g.moveTo(56, 26); g.lineTo(122, 6); g.lineTo(124, 11); g.lineTo(60, 32); g.closePath(); });
    fill(pal.a, () => { g.beginPath(); g.arc(36, 30, 3, 0, 7); });
  }

  else if (k === 'mot') {
    flat(g, pal.d, () => { g.beginPath(); g.ellipse(26, 46, 9, 6, 0, 0, 7); g.ellipse(92, 46, 9, 6, 0, 0, 7); });
    flat(g, pal.b, () => { g.beginPath();
      g.moveTo(14, 40); g.lineTo(18, 24); g.lineTo(96, 24); g.lineTo(106, 32); g.lineTo(106, 40); g.closePath(); });
    fill(pal.s, () => { rr(g, 68, 16, 32, 12, 3); });
    fill(pal.g, () => { rr(g, 74, 18, 18, 7, 2); });
    fill(pal.a, () => { rr(g, 22, 30, 16, 5, 1); });
  }

  else if (k === 'aa') {
    flat(g, pal.d, () => { rr(g, 16, 38, 88, 11, 4); });
    flat(g, pal.b, () => { rr(g, 22, 20, 68, 18, 3); });
    fill(pal.s, () => { g.beginPath(); g.moveTo(50, 20); g.lineTo(58, 0); g.lineTo(68, 0); g.lineTo(72, 20); g.closePath(); });
    st(pal.l, 1.3, () => { g.beginPath(); for (let i = 0; i < 3; i++) { g.moveTo(55 + i * 5, 17); g.lineTo(56 + i * 5, 2) } });
    fill(pal.a, () => { rr(g, 56, -4, 14, 5, 1); });
  }

  else if (k === 'ew') {
    flat(g, pal.d, () => { rr(g, 14, 40, 92, 10, 4); });
    flat(g, pal.b, () => { rr(g, 18, 24, 82, 16, 3); });
    fill(pal.s, () => { rr(g, 46, 4, 6, 22, 1); });
    st(pal.l, 1.6, () => { g.beginPath();
      g.moveTo(49, 4); g.lineTo(36, -8); g.moveTo(49, 4); g.lineTo(62, -8);
      g.moveTo(49, 12); g.lineTo(30, 8); g.moveTo(49, 12); g.lineTo(68, 8); });
    fill(pal.a, () => { g.beginPath(); g.arc(49, 2, 3, 0, 7); });
  }

  else if (k === 'hel') {
    st('rgba(6,8,6,.5)', 2.4, () => { g.beginPath(); g.moveTo(8, 40); g.lineTo(104, 40); g.moveTo(16, 46); g.lineTo(16, 40); g.moveTo(96, 46); g.lineTo(96, 40); });
    flat(g, pal.b, () => { g.beginPath(); g.ellipse(54, 28, 32, 11, 0, 0, 7); });
    fill(pal.s, () => { g.beginPath(); g.moveTo(86, 24); g.lineTo(118, 27); g.lineTo(118, 31); g.lineTo(86, 32); g.closePath(); });
    fill(pal.g, () => { g.beginPath(); g.ellipse(74, 25, 9, 6, 0, 0, 7); });
    st(pal.l, 2, () => { g.beginPath(); g.moveTo(8, 20); g.lineTo(100, 20); });
    fill(pal.a, () => { g.beginPath(); g.arc(54, 20, 2.6, 0, 7); });
  }

  else if (k === 'jet') {
    flat(g, pal.b, () => { g.beginPath();
      g.moveTo(124, 28); g.lineTo(78, 22); g.lineTo(30, 26); g.lineTo(8, 32); g.lineTo(30, 36); g.lineTo(78, 34); g.closePath(); });
    fill(pal.s, () => { g.beginPath();
      g.moveTo(60, 24); g.lineTo(16, 8); g.lineTo(32, 26); g.closePath();
      g.moveTo(60, 34); g.lineTo(24, 52); g.lineTo(36, 34); g.closePath();
      g.moveTo(94, 25); g.lineTo(108, 16); g.lineTo(110, 19); g.lineTo(98, 28); g.closePath();
      g.moveTo(94, 33); g.lineTo(108, 42); g.lineTo(110, 39); g.lineTo(98, 30); g.closePath(); });
    fill(pal.g, () => { g.beginPath(); g.ellipse(92, 27.5, 9, 4.4, 0, 0, 7); });
    fill(pal.a, () => { rr(g, 4, 30, 8, 4, 1); });
  }

  else if (k === 'uav') {
    flat(g, pal.b, () => { rr(g, 38, 25, 44, 10, 4); });
    st(pal.s, 2.2, () => { g.beginPath(); g.moveTo(18, 19); g.lineTo(104, 19); g.moveTo(18, 41); g.lineTo(104, 41); });
    st(pal.l, 1, () => { g.beginPath(); g.moveTo(18, 19); g.lineTo(18, 41); g.moveTo(104, 19); g.lineTo(104, 41); });
    fill(pal.a, () => { g.beginPath(); g.arc(60, 30, 3, 0, 7); });
  }

  else if (k === 'atkd') {
    flat(g, pal.b, () => { g.beginPath(); g.moveTo(112, 30); g.lineTo(42, 22); g.lineTo(14, 30); g.lineTo(42, 38); g.closePath(); });
    fill(pal.s, () => { g.beginPath();
      g.moveTo(52, 24); g.lineTo(28, 10); g.lineTo(44, 24); g.closePath();
      g.moveTo(52, 36); g.lineTo(28, 50); g.lineTo(44, 36); g.closePath(); });
    fill(pal.a, () => { g.beginPath(); g.arc(22, 30, 3, 0, 7); });
    fill(pal.d, () => { g.beginPath(); g.arc(86, 30, 3, 0, 7); });
  }

  else { /* inf — отделение пехоты цепью, вид сверху, плоские кружки */
    const sp = [[18, 30], [38, 20], [38, 40], [60, 14], [60, 46], [84, 24], [84, 36], [106, 30]];
    g.fillStyle = pal.d;
    g.beginPath(); for (const [x, y] of sp) g.ellipse(x, y + 3, 6.2, 4, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(6,8,6,.6)'; g.lineWidth = 1.6;
    g.beginPath(); for (const [x, y] of sp) g.arc(x, y, 4.4, 0, 7); g.stroke();
    g.fillStyle = pal.b;
    g.beginPath(); for (const [x, y] of sp) g.arc(x, y, 4.4, 0, 7); g.fill();
    g.fillStyle = pal.s;
    g.beginPath(); for (const [x, y] of sp) g.arc(x + 2.2, y, 1.5, 0, 7); g.fill();
  }
  g.restore();
}

const ICON_CACHE = new Map();
function iconImg(k, enemy, px) {
  px = Math.max(28, Math.round(px / 2) * 2);
  const id = k + (enemy ? 'e' : 'o') + px;
  let c = ICON_CACHE.get(id);
  if (c) return c;
  c = document.createElement('canvas');
  const h = px * .62;
  c.width = Math.ceil(px * DPR) + 8; c.height = Math.ceil(h * DPR) + 10;
  const g = c.getContext('2d');
  g.scale(DPR, DPR);
  g.translate(4, 8);
  g.scale(px / 128, px / 128);
  sil(g, k, enemy ? PAL_EN : PAL_OWN);
  ICON_CACHE.set(id, c);
  return c;
}

function hourOf() { return (G.t / 3600 + 6) % 24 }
function nightK() {
  const h = hourOf();
  if (h >= 21 || h < 5) return 1;
  if (h < 7) return 1 - (h - 5) / 2;
  if (h >= 18) return (h - 18) / 3;
  return 0;
}

function clipMap() {
  const a = w2s({ x: 0, y: 0 }), b = w2s({ x: WW, y: WH });
  cx.beginPath(); cx.rect(a.x, a.y, b.x - a.x, b.y - a.y); cx.clip();
}

function grainTile() {
  if (GRAIN) return GRAIN;
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d'), d = g.createImageData(96, 96);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255 | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 18;
  }
  g.putImageData(d, 0, 0); GRAIN = c; return c;
}

const CITY_LIGHTS = new Map();
function cityLights(c) {
  let L = CITY_LIGHTS.get(c.id);
  if (L) return L;
  let seed = 0;
  for (const ch of c.n) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  L = [];
  const n = 8 + c.w * 10;
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.28, r = Math.sqrt(rnd()) * (c.w * 2.2 + 1.6);
    L.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, k: rnd(), sz: .5 + rnd() * .9 });
  }
  CITY_LIGHTS.set(c.id, L);
  return L;
}

function drawCityLights(s) {
  const fade = nightK();
  if (fade < .05) return;
  cx.save();
  cx.globalCompositeOperation = 'lighter';
  for (const c of G.pts.filter(p => p.city)) {
    const q = w2s(c);
    if (q.x < -80 || q.x > CW + 80) continue;
    const L = cityLights(c);
    let lit = 0;
    for (const p of L) {
      lit++;
      const fl = .7 + .3 * Math.sin(ANIM * (3 + p.k * 7) + p.x);
      const r = Math.max(1.5, p.sz * 1.5 * clamp(s / 2.2, .8, 2.6));
      const qq = w2s(p);
      cx.fillStyle = c.owner === S ? `rgba(255,200,140,${.42 * fade})` : `rgba(255,218,150,${.78 * fl * fade})`;
      cx.fillRect(qq.x - r / 2, qq.y - r / 2, r, r);
    }
    const R = (c.w * 3.6 + 6) * s;
    const g = cx.createRadialGradient(q.x, q.y, 0, q.x, q.y, R);
    g.addColorStop(0, `rgba(255,190,110,${.22 * fade})`);
    g.addColorStop(1, 'rgba(255,190,110,0)');
    cx.fillStyle = g;
    cx.fillRect(q.x - R, q.y - R, R * 2, R * 2);
  }
  cx.restore();
}

function drawNightShade() {
  const k = nightK();
  cx.save(); clipMap();
  cx.fillStyle = `rgba(4,10,24,${.38 * k})`;
  cx.fillRect(0, 0, CW, CH);
  const h = hourOf();
  if (h > 4.5 && h < 8) {
    const t = Math.sin(((h - 4.5) / 3.5) * Math.PI);
    const g = cx.createLinearGradient(CW, 0, 0, 0);
    g.addColorStop(0, `rgba(255,150,90,${.14 * t})`);
    g.addColorStop(.6, 'rgba(255,150,90,0)');
    cx.fillStyle = g; cx.fillRect(0, 0, CW, CH);
  }
  cx.restore();
}

function drawGrid(s) {
  if (s < 3.1) return;
  const a = clamp((s - 3.1) / 4, 0, .5);
  cx.save(); clipMap();
  cx.strokeStyle = `rgba(150,190,210,${a * .28})`; cx.lineWidth = 1;
  cx.beginPath();
  for (let x = 0; x <= WW; x += GRID) {
    const q = w2s({ x, y: 0 }), q2 = w2s({ x, y: WH }); cx.moveTo(q.x, q.y); cx.lineTo(q2.x, q2.y);
  }
  for (let y = 0; y <= WH; y += GRID) {
    const q = w2s({ x: 0, y }), q2 = w2s({ x: WW, y }); cx.moveTo(q.x, q.y); cx.lineTo(q2.x, q2.y);
  }
  cx.stroke();
  if (s > 5.6) {
    cx.fillStyle = `rgba(150,190,210,${a * .5})`;
    cx.font = '10px ui-monospace,monospace'; cx.textAlign = 'left';
    for (let x = 0; x < WW; x += GRID) for (let y = 0; y < WH; y += GRID) {
      const q = w2s({ x: x + 1, y: y + 5 });
      if (q.x > 0 && q.x < CW && q.y > 0 && q.y < CH) cx.fillText(Math.round(x / 10) + '' + Math.round(y / 10), q.x, q.y);
    }
  }
  cx.restore();
}

function drawFront(s) {
  /* фронт вертикальный: для каждого y — своя x. Запад (n) слева, восток (s) справа. */
  if (!G.frontY.length) return;
  const fy = G.frontY.map(w2s);
  cx.save(); clipMap();
  cx.beginPath();
  const w0 = w2s({ x: 0, y: 0 }), w1 = w2s({ x: 0, y: WH });
  cx.moveTo(w0.x, w0.y); cx.lineTo(fy[0].x, fy[0].y);
  fy.forEach(p => cx.lineTo(p.x, p.y));
  cx.lineTo(w1.x, w1.y); cx.closePath();
  cx.fillStyle = 'rgba(80,150,210,.13)'; cx.fill();
  cx.beginPath();
  const e0 = w2s({ x: WW, y: 0 }), e1 = w2s({ x: WW, y: WH });
  cx.moveTo(e0.x, e0.y); cx.lineTo(fy[0].x, fy[0].y);
  fy.forEach(p => cx.lineTo(p.x, p.y));
  cx.lineTo(e1.x, e1.y); cx.closePath();
  cx.fillStyle = 'rgba(210,70,50,.13)'; cx.fill();

  cx.beginPath();
  fy.forEach((p, i) => i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y));
  cx.strokeStyle = 'rgba(242,179,61,.25)'; cx.lineWidth = 8; cx.stroke();
  cx.strokeStyle = '#f2b33d'; cx.lineWidth = 2.1; cx.setLineDash([7, 5]);
  cx.stroke(); cx.setLineDash([]);
  cx.restore();
}

/** зона высадки своей стороны — подсветка на время расстановки */
function drawDeployZone(s) {
  if (G.phase !== 'deploy' || !G.deployZone) return;
  const z = G.deployZone;
  const a = w2s({ x: z.x0, y: 6 }), b = w2s({ x: z.x1, y: WH - 6 });
  cx.save(); clipMap();
  cx.fillStyle = 'rgba(242,179,61,.1)';
  cx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  cx.strokeStyle = 'rgba(242,179,61,.6)'; cx.lineWidth = 1.6; cx.setLineDash([9, 6]);
  cx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  cx.setLineDash([]);
  if (s > 1) {
    cx.fillStyle = 'rgba(242,179,61,.75)'; cx.font = '600 13px system-ui,sans-serif'; cx.textAlign = 'center';
    cx.fillText('ЗОНА ВЫСАДКИ', (a.x + b.x) / 2, a.y + 18);
  }
  cx.restore();
}

function drawPoints(s) {
  for (const p of G.pts) {
    const q = w2s(p);
    if (q.x < -40 || q.x > CW + 40) continue;
    const col = p.owner === N ? '#6cc3ff' : '#ff8a72';
    if (p.city) {
      const R = (p.w * 2.2 + 4) * clamp(s / 2.4, .7, 1.8);
      cx.strokeStyle = col; cx.lineWidth = 1.4; cx.globalAlpha = .85;
      cx.strokeRect(q.x - 4, q.y - 4, 8, 8);
      cx.fillStyle = col; cx.globalAlpha = 1;
      cx.beginPath(); cx.arc(q.x, q.y, p.w >= 2.5 ? 3.2 : 2.3, 0, 7); cx.fill();
      if (s > 2.2) {
        cx.font = `${p.w >= 2 ? '600 ' : ''} ${p.w >= 2.5 ? 13 : 11}px system-ui,sans-serif`;
        cx.textAlign = 'left';
        cx.fillStyle = 'rgba(0,0,0,.7)'; cx.fillText(p.n, q.x + 8, q.y + 5);
        cx.fillStyle = p.owner === S ? 'rgba(255,150,130,.88)' : p.w >= 2 ? 'rgba(226,235,240,.94)' : 'rgba(180,196,206,.78)';
        cx.fillText(p.n, q.x + 7, q.y + 4);
      }
    } else {
      cx.fillStyle = col; cx.globalAlpha = .9;
      cx.beginPath(); cx.arc(q.x, q.y, 2.4, 0, 7); cx.fill(); cx.globalAlpha = 1;
      if (s > 3) {
        cx.fillStyle = 'rgba(180,196,206,.75)'; cx.font = '10.5px system-ui,sans-serif';
        cx.textAlign = 'left'; cx.fillText(p.n, q.x + 6, q.y + 4);
      }
    }
    if (p.cap > 0) {
      cx.strokeStyle = COL[p.capSide]; cx.lineWidth = 2.2;
      cx.beginPath(); cx.arc(q.x, q.y, 9, -1.57, -1.57 + 6.28 * (p.cap / 100)); cx.stroke();
    }
  }
}

function stColor(u) {
  if (u.st === 'move' || u.st === 'strike' || u.st === 'air') return '#6cc3ff';
  if (u.hp < KINDS[u.k].hp * .45) return '#ff5b47';
  if (u.st !== 'ready') return '#f2b33d';
  return '#6fd18d';
}

function drawUnits(s) {
  const sel = G.sel && unitById(G.sel.id);
  const L = clamp(s * 7.5, 36, 118);
  const list = G.units.filter(u => u.hp > 0).sort((a, b) => KINDS[a.k].air - KINDS[b.k].air);
  for (const u of list) {
    if (!playerSees(u)) continue;
    const q = w2s(u);
    if (q.x < -80 || q.x > CW + 80 || q.y < -80 || q.y > CH + 80) continue;
    const T = KINDS[u.k];
    const isSel = sel === u;
    const col = u.side === N ? 'rgba(150,200,185,.55)' : 'rgba(230,140,110,.55)';

    if (u.trail && u.trail.length > 4) {
      cx.beginPath();
      for (let i = 0; i < u.trail.length; i += 2) {
        const p = w2s({ x: u.trail[i], y: u.trail[i + 1] });
        i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y);
      }
      cx.strokeStyle = u.side === N ? 'rgba(150,220,255,.35)' : 'rgba(255,160,120,.35)';
      cx.lineWidth = u.k === 'jet' ? 1.6 : 1.1; cx.stroke();
    }
    if (u.dest) {
      const d = w2s(u.dest);
      cx.strokeStyle = u.side === N ? 'rgba(108,195,255,.4)' : 'rgba(255,91,71,.35)';
      cx.setLineDash([5, 4]); cx.lineWidth = 1.1;
      cx.beginPath(); cx.moveTo(q.x, q.y); cx.lineTo(d.x, d.y); cx.stroke(); cx.setLineDash([]);
    }
    if (isSel) {
      cx.beginPath(); cx.arc(q.x, q.y, T.rng * s, 0, 7);
      cx.fillStyle = T.vs === 'a' ? 'rgba(108,195,255,.07)' : 'rgba(111,209,141,.08)';
      cx.fill();
      cx.strokeStyle = T.vs === 'a' ? 'rgba(108,195,255,.7)' : 'rgba(111,209,141,.7)';
      cx.lineWidth = 1.5; cx.stroke();
      if (T.jam) {
        cx.beginPath(); cx.arc(q.x, q.y, T.jam * s, 0, 7);
        cx.fillStyle = 'rgba(150,255,190,.06)'; cx.fill();
        cx.strokeStyle = 'rgba(150,255,190,.4)'; cx.setLineDash([4, 4]); cx.stroke(); cx.setLineDash([]);
      }
    }

    const W = T.air ? L * 1.15 : L * 1.2, H = L * .72;
    drawPlate(cx, q.x, q.y, W, H, stColor(u), isSel);
    const img = iconImg(u.k, u.side === S, W * .92);
    const iw = img.width / DPR, ih = img.height / DPR;
    const flip = Math.cos(u.hd || 0) < 0;
    cx.save();
    if (flip) { cx.translate(q.x, q.y); cx.scale(-1, 1); cx.translate(-q.x, -q.y); }
    cx.drawImage(img, q.x - iw / 2, q.y - ih / 2 - 1, iw, ih);
    cx.restore();
    if (u.k === 'hel') {
      cx.save(); cx.translate(q.x, q.y - H * .12); cx.rotate(ANIM * 14);
      cx.strokeStyle = 'rgba(230,235,220,.55)'; cx.lineWidth = 1;
      cx.beginPath(); cx.moveTo(-W * .38, 0); cx.lineTo(W * .38, 0); cx.stroke();
      cx.restore();
    }
    const bw = Math.max(22, W * .72);
    cx.fillStyle = 'rgba(6,10,14,.75)';
    cx.fillRect(q.x - bw / 2, q.y + H / 2 + 3, bw, 3.5);
    cx.fillStyle = u.hp / T.hp < .4 ? '#ff5b47' : '#6fd18d';
    cx.fillRect(q.x - bw / 2, q.y + H / 2 + 3, bw * clamp(u.hp / T.hp, 0, 1), 3.5);
    if (s > 2.4) {
      cx.font = '600 10px system-ui,sans-serif'; cx.textAlign = 'center';
      cx.fillStyle = 'rgba(0,0,0,.7)'; cx.fillText(T.sh, q.x + 1, q.y - H / 2 - 4);
      cx.fillStyle = '#e6eef2'; cx.fillText(T.sh, q.x, q.y - H / 2 - 5);
    }
  }
}

function drawFx() {
  for (const f of G.fx) {
    const q = w2s(f);
    const a = f.t / 28;
    if (f.k === 'boom') {
      const R = (30 - f.t) * 1.8;
      const g = cx.createRadialGradient(q.x, q.y, 0, q.x, q.y, R);
      g.addColorStop(0, `rgba(255,230,180,${a})`);
      g.addColorStop(.4, `rgba(255,140,50,${a * .7})`);
      g.addColorStop(1, 'rgba(40,20,10,0)');
      cx.fillStyle = g; cx.beginPath(); cx.arc(q.x, q.y, R, 0, 7); cx.fill();
    } else {
      cx.fillStyle = `rgba(255,220,160,${a})`;
      cx.beginPath(); cx.arc(q.x, q.y, 2.2, 0, 7); cx.fill();
    }
  }
}

function drawScreenFX() {
  cx.save();
  const v = cx.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * .35, CW / 2, CH / 2, Math.max(CW, CH) * .78);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.42)');
  cx.fillStyle = v; cx.fillRect(0, 0, CW, CH);
  const t = grainTile(), p = cx.createPattern(t, 'repeat');
  if (p) {
    cx.globalAlpha = .5;
    cx.translate((Math.random() * 96) | 0, (Math.random() * 96) | 0);
    cx.fillStyle = p; cx.fillRect(-96, -96, CW + 192, CH + 192);
  }
  cx.restore();
}

function drawRose() {
  const x = CW / 2, y = CH - 36;
  cx.save(); cx.translate(x, y);
  cx.strokeStyle = 'rgba(200,214,224,.35)'; cx.fillStyle = 'rgba(200,214,224,.7)';
  cx.lineWidth = 1; cx.beginPath(); cx.arc(0, 0, 16, 0, 7); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -16); cx.lineTo(0, 16); cx.moveTo(-16, 0); cx.lineTo(16, 0); cx.stroke();
  cx.font = '600 9px system-ui,sans-serif'; cx.textAlign = 'center';
  cx.fillText('С', 0, -20); cx.fillText('Ю', 0, 26);
  cx.restore();
  const km = 40, px = km * G.view.s;
  cx.strokeStyle = 'rgba(200,214,224,.5)'; cx.lineWidth = 1.4;
  cx.beginPath(); cx.moveTo(CW / 2 - px / 2, CH - 14); cx.lineTo(CW / 2 + px / 2, CH - 14); cx.stroke();
  cx.fillStyle = 'rgba(200,214,224,.65)'; cx.font = '10px ui-monospace,monospace'; cx.textAlign = 'center';
  cx.fillText(km + ' км', CW / 2, CH - 18);
}

function applyShake() {
  const el = document.getElementById('map');
  if (!el) return;
  if (SHAKE < .25) { el.style.transform = ''; SHAKE = 0; return }
  el.style.transform = `translate(${(Math.random() - .5) * SHAKE}px,${(Math.random() - .5) * SHAKE}px)`;
  SHAKE *= .86;
}

function draw() {
  if (!TER) bakeTerrain();
  ANIM += 1 / 60;
  const s = G.view.s;
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  cx.fillStyle = '#04070a';
  cx.fillRect(0, 0, CW, CH);
  cx.save();
  cx.translate(CW / 2, CH / 2); cx.scale(s, s); cx.translate(-G.view.x, -G.view.y);
  cx.imageSmoothingEnabled = s < 6;
  cx.drawImage(TER, 0, 0, WW, WH);
  cx.restore();
  drawNightShade();
  drawCityLights(s);
  drawGrid(s);
  drawFront(s);
  drawDeployZone(s);
  drawPoints(s);
  drawUnits(s);
  drawFx();
  drawScreenFX();
  applyShake();
  const a = w2s({ x: 0, y: 0 }), b = w2s({ x: WW, y: WH });
  cx.strokeStyle = '#1d2b36'; cx.lineWidth = 2;
  cx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  drawRose();
}

function gfxBoom(x, y) {
  SHAKE = Math.max(SHAKE, 5);
}
