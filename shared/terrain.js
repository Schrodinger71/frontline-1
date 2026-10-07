'use strict';
/* ============================================================
   МЕСТНОСТЬ: лес и дороги как чистые функции от координат —
   у сервера и клиента нет общей карты-битмапа, поэтому и бой
   (сервер), и подсветка на холсте (client/js/gfx.js) считают
   «лес здесь или нет» одной и той же формулой по одним и тем
   же сидам шума, так что визуальный лес и игровой лес совпадают.
   gfx.js рисует фон отдельно (просто быстрее для холста) —
   сюда он НЕ ходит, но использует то же isForest при желании
   подсветить клетку. Дороги — те же кривые, что рисует карта.
   ============================================================ */
(function (g) {
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
  /** совпадает по формуле с F[k] в client/js/gfx.js:bakeTerrain — не трогать одну без другой */
  function isForest(x, y, WH) {
    const H = fbm(x * .018, y * .018, 7, 5);
    const F = fbm(x * .055, y * .055, 31, 3) + (1 - y / WH) * .05 + H * .12;
    return F > .61;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
  function bendy(a, b, n, amp, seed) {
    const L = dist(a, b) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L, pts = [];
    for (let q = 0; q <= n; q++) {
      const t = q / n, j = (fbm(t * 4, seed, seed, 4) - .5) * 2 * amp * Math.sin(Math.PI * t);
      pts.push({ x: a.x + (b.x - a.x) * t + nx * j, y: a.y + (b.y - a.y) * t + ny * j });
    }
    return pts;
  }
  /** та же сеть дорог, что рисует client/js/gfx.js:bakeTerrain (одинаковые links и сиды) */
  let ROADS = null;
  function buildRoads(POINT_DEF) {
    if (ROADS) return ROADS;
    const links = [[0, 4], [1, 3], [2, 4], [4, 6], [6, 10], [10, 12], [11, 12], [5, 8], [8, 11], [7, 10], [7, 13], [13, 12], [2, 7]];
    const roads = [];
    for (const [ia, ib] of links) {
      if (!POINT_DEF[ia] || !POINT_DEF[ib]) continue;
      roads.push(bendy(POINT_DEF[ia], POINT_DEF[ib], 10, 7, ia * 13 + ib));
    }
    roads.push(bendy({ x: 118, y: 20 }, { x: 132, y: 420 }, 16, 9, 3));
    return (ROADS = roads);
  }
  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }
  function roadDist(x, y, POINT_DEF) {
    const roads = buildRoads(POINT_DEF);
    let best = 1e9;
    for (const r of roads) for (let i = 1; i < r.length; i++) {
      const d = distToSeg({ x, y }, r[i - 1], r[i]);
      if (d < best) best = d;
    }
    return best;
  }
  function onRoad(x, y, POINT_DEF, radius) { return roadDist(x, y, POINT_DEF) < (radius || 4) }

  const api = { h2, vnoise, fbm, isForest, buildRoads, roadDist, onRoad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else g.Terrain = api;
})(typeof window !== 'undefined' ? window : globalThis);
