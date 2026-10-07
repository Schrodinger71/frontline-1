'use strict';
/* ============================================================
   ЛИНИЯ — клиент.
   Вся симуляция и ИИ — на сервере (server/engine.js). Здесь:
   сеть, лобби, ввод и интерполяция позиций между снимками.
   Карту и части рисует js/gfx.js — он не менялся.
   ============================================================ */

const SPEEDS = [0, 15, 60, 180, 600];
const MODE_LABEL = { defense: 'Оборона', attack: 'Наступление', both: 'Встречный бой' };
const ROLE_LABEL = { attacker: 'наступление', defender: 'оборона', both: 'равные силы' };

const $ = q => document.querySelector(q);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = t => {
  const h = Math.floor((t / 3600 + 6) % 24), m = Math.floor(t / 60) % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
};

const G = {
  t: 0, speed: 60, units: [], pts: [], fx: [], frontY: [],
  sel: null, pending: null, view: { x: 220, y: 150, s: 2.2 },
  tabL: 'radio', tabR: 'ord',
  side: null, gmode: null, role: null, over: null, weather: 'ясно', commanders: null,
  roomId: null, vsBot: true, seats: { n: 0, s: 0 },
  phase: null, deployT: 0, ready: { n: false, s: false }, deployZone: null, price: null,
  budget: 0, income: 0,
  _gotFirst: false, _overShown: false
};

/* ---------- сеть ---------- */
let ws = null, wsRetry = 0, pendingSend = null;
function wsUrl() { return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws' }
function netConnect() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => { wsRetry = 0; if (pendingSend) { netSend(pendingSend); pendingSend = null } };
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data) } catch (err) { return }
    onNetMessage(m);
  };
  ws.onclose = () => { setTimeout(netConnect, Math.min(5000, 400 * Math.pow(1.7, wsRetry++))) };
}
function netSend(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); else { pendingSend = o; if (!ws || ws.readyState === 3) netConnect() } }
let cmdSeq = 0;
function order(u, cmd, args) {
  if (cmd === 'move') { u.dest = { x: args.x, y: args.y }; u.st = KINDS[u.k].strike ? 'strike' : 'move' }
  else if (cmd === 'hold') { u.dest = null; u.st = 'ready' }
  else if (cmd === 'rtb') { u.st = 'rtb' }
  netSend({ t: 'order', id: ++cmdSeq, unitId: u.id, cmd, args: args || {} });
}

function onNetMessage(m) {
  if (m.t === 'joined') return onJoined(m);
  if (m.t === 'snap') return applySnapshot(m.v);
  if (m.t === 'ev') return handleEvents(m.list);
  if (m.t === 'seats') { G.seats = m.seats; updateWaitHint(); if (m.note) toast(m.note); return }
  if (m.t === 'error') { toast(m.msg); showMenu(); return }
  if (m.t === 'res') { if (m.res && !m.res.ok && m.res.error) toast(m.res.error); return }
}

function onJoined(m) {
  G.roomId = m.room; G.gmode = m.mode; G.side = m.side; G.vsBot = m.vsBot; G.seats = m.seats;
  G.units = []; G.sel = null; G.pending = null; G._gotFirst = false; G._overShown = false;
  hideMenu(); hideModal(); hint('');
  $('#lc_radio').innerHTML = '';
  $('#hdRoomBox').style.display = m.vsBot ? 'none' : '';
  $('#hdRoom').textContent = m.room;
  updateWaitHint();
}

function updateWaitHint() {
  if (G.vsBot || !G.roomId) { hint(''); return }
  const total = (G.seats.n || 0) + (G.seats.s || 0);
  hint(total < 2 ? `Партия ${G.roomId}: ждём соперника по коду — поделитесь им.` : '');
}

function onFirstSnap() {
  const mine = G.units.filter(u => u.side === G.side);
  let cx, cy;
  if (mine.length) {
    cx = mine.reduce((s, u) => s + u.x, 0) / mine.length;
    cy = mine.reduce((s, u) => s + u.y, 0) / mine.length;
  } else if (G.deployZone) {
    cx = (G.deployZone.x0 + G.deployZone.x1) / 2; cy = WH / 2;
  } else { cx = G.side === S ? 220 : 80; cy = WH / 2 }
  G.view = { x: cx, y: cy, s: 2.1 };
  showHelp(false);
}

function applySnapshot(v) {
  G.t = v.t; G.speed = v.speed; G.over = v.over; G.weather = v.weather;
  G.commanders = v.commanders; G.role = v.role; G.gmode = v.mode;
  G.phase = v.phase; G.deployT = v.deployT; G.ready = v.ready; G.deployZone = v.deployZone;
  G.budget = v.budget; G.income = v.income; G.price = G.price || v.price;
  G.pts = v.pts;
  mergeUnits(v.units);
  G.frontY = v.frontY;
  if (!G._gotFirst) { G._gotFirst = true; onFirstSnap() }
  if (G.over && !G._overShown) { G._overShown = true; showHelp(true) }
}

function mergeUnits(list) {
  const seen = new Set();
  for (const s of list) {
    seen.add(s.id);
    let u = unitById(s.id);
    if (!u) { u = { id: s.id, x: s.x, y: s.y, hd: s.hd, trail: [] }; G.units.push(u) }
    u.k = s.k; u.side = s.side; u.hp = s.hp; u.dest = s.dest; u.st = s.st;
    u.cs = s.cs; u.fuel = s.fuel; u.am = s.am; u.trait = s.trait; u.terr = s.terr;
    u.tx = s.x; u.ty = s.y; u.thd = s.hd;
  }
  G.units = G.units.filter(u => seen.has(u.id));
  if (G.sel && !seen.has(G.sel.id)) G.sel = null;
}

function handleEvents(list) {
  for (const ev of list) {
    if (ev.type === 'log') {
      if (ev.hq) radioHQ(ev.text, ev.cls, ev.t);
      else radio(ev.cs || '?', ev.text, ev.cls, ev.t);
    } else if (ev.type === 'fx') {
      G.fx.push({ k: ev.kind, x: ev.x, y: ev.y, t: ev.kind === 'boom' ? 28 : 12 });
      if (ev.kind === 'boom' && typeof gfxBoom === 'function') gfxBoom(ev.x, ev.y);
    }
  }
}

/* ---------- эфир ---------- */
function radio(cs, txt, cls, t) {
  const box = $('#lc_radio');
  const ln = document.createElement('div');
  ln.className = 'ln ' + (cls || '');
  ln.innerHTML = `<span class="tm">${clock(t)}</span><span class="who">«${esc(cs)}»</span> ${esc(txt)}`;
  box.appendChild(ln);
  while (box.children.length > 180) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}
function radioHQ(txt, cls, t) {
  const box = $('#lc_radio');
  const ln = document.createElement('div');
  ln.className = 'ln ' + (cls || 'hq');
  ln.innerHTML = `<span class="tm">${clock(t)}</span><span class="who hq">ШТАБ</span> ${esc(txt)}`;
  box.appendChild(ln);
  box.scrollTop = box.scrollHeight;
}
let toastT = 0;
function toast(t) {
  const el = $('#toast');
  el.textContent = t; el.style.display = 'block';
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.style.display = 'none' }, 2400);
}
function hint(t) {
  const el = $('#hintbar');
  el.style.display = t ? 'block' : 'none';
  el.textContent = t || '';
}

/* ---------- отрисовка: интерполяция между снимками ---------- */
function unitById(id) { return G.units.find(u => u.id === id) }
function playerSees() { return true } /* сервер уже отфильтровал туман войны */

function interpolate(dt) {
  const k = clamp(dt * 8, 0, 1);
  for (const u of G.units) {
    u.x += ((u.tx ?? u.x) - u.x) * k;
    u.y += ((u.ty ?? u.y) - u.y) * k;
    if (u.thd !== undefined) u.hd = u.thd;
    if (KINDS[u.k].air && u.dest) {
      u.trail.push(u.x, u.y);
      if (u.trail.length > 48) u.trail.splice(0, 2);
    }
  }
  G.fx.forEach(f => f.t--);
  G.fx = G.fx.filter(f => f.t > 0);
}

/* ---------- холст ---------- */
let cv, cx, CW = 0, CH = 0, DPR = 1;
const w2s = p => ({ x: (p.x - G.view.x) * G.view.s + CW / 2, y: (p.y - G.view.y) * G.view.s + CH / 2 });
const s2w = p => ({ x: (p.x - CW / 2) / G.view.s + G.view.x, y: (p.y - CH / 2) / G.view.s + G.view.y });
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  CW = cv.clientWidth; CH = cv.clientHeight;
  cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
}

/* ---------- UI ---------- */
function renderTop() {
  if (!G.roomId) return;
  $('#hdClock').textContent = clock(G.t);
  $('#hdDay').textContent = String(1 + Math.floor((G.t / 3600 + 6) / 24));
  $('#hdWeather').textContent = G.weather || '—';
  const fx = G.frontY, avg = fx.length ? fx.reduce((s, p) => s + p.x, 0) / fx.length : WW / 2;
  const sh = (avg - WW / 2) / (WW / 2);
  $('#hdFront').textContent = Math.abs(sh) < .04 ? 'ровно' : (sh < 0 ? 'на запад ' : 'на восток ') + Math.round(Math.abs(sh) * 100) + '%';
  const mySide = G.side, oppSide = mySide === N ? S : N;
  const cities = G.pts.filter(p => p.city);
  $('#hdCities').innerHTML = `<span class="good">${cities.filter(p => p.owner === mySide).length}</span> / <span class="bad">${cities.filter(p => p.owner === oppSide).length}</span>`;
  const myF = G.units.filter(u => u.side === mySide && u.hp > 0).length;
  const opF = G.units.filter(u => u.side === oppSide && u.hp > 0).length;
  $('#hdForce').innerHTML = `<span class="good">${myF}</span> · <span class="bad">${opF}</span><span class="mu"> (видимые)</span>`;
  $('#hdBudget').textContent = Math.round(G.budget);
  $('#hdIncome').textContent = '+' + G.income.toFixed(1) + '/с';
  updateDeployBar();
}

function updateDeployBar() {
  const bar = $('#deployBar');
  if (G.phase !== 'deploy') { bar.hidden = true; return }
  bar.hidden = false;
  const t = Math.max(0, Math.ceil(G.deployT));
  $('#dpTime').textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  const mySide = G.side, oppSide = mySide === N ? S : N;
  const btn = $('#btnReady');
  const amReady = G.ready[mySide];
  btn.textContent = amReady ? 'Ждём соперника…' : 'Готов';
  btn.disabled = amReady;
  $('#dpWait').textContent = G.vsBot ? '' : (G.ready[oppSide] ? 'Соперник готов.' : 'Соперник расставляется…');
}

function renderSpeed() {
  const box = $('#speedBox');
  box.innerHTML = '<div class="seg">' + SPEEDS.map(s =>
    `<button data-sp="${s}" class="${G.speed === s ? 'on' : ''}">${s ? '×' + s : 'II'}</button>`
  ).join('') + '</div>';
}

function renderPts() {
  const el = $('#lc_pts');
  const mySide = G.side;
  el.innerHTML = G.pts.map(p => `
    <div class="ptn" data-go="${p.id}">
      <span>${esc(p.n)}${p.city ? ' · город' : ''}</span>
      <b class="${p.owner === mySide ? 'good' : 'bad'}">${p.owner === mySide ? 'наши' : 'противник'}</b>
    </div>
    ${p.cap > 0 ? `<div class="cap"><div style="width:${p.cap}%;background:${COL[p.capSide]}"></div></div>` : ''}
  `).join('');
}

function renderHQ() {
  const rc = $('#rc');
  const mySide = G.side, oppSide = mySide === N ? S : N;
  const c1 = G.commanders && G.commanders[mySide], c2 = G.commanders && G.commanders[oppSide];
  const myRole = G.role && G.role[mySide], opRole = G.role && G.role[oppSide];
  rc.innerHTML = `<div class="card">
    <h3>Штабы</h3>
    <div class="row"><span>Режим</span><b>${esc(MODE_LABEL[G.gmode] || G.gmode || '—')}</b></div>
    <div class="row"><span>Моя роль</span><b>${esc(ROLE_LABEL[myRole] || '—')}</b></div>
    <div class="lbl">Моё командование</div>
    <div class="row"><span>${c1 ? esc(c1.name) : '—'}</span><b>${c1 ? esc(c1.trait) : ''}</b></div>
    <div class="lbl">Противник (${esc(ROLE_LABEL[opRole] || '—')})</div>
    <div class="row"><span>${c2 ? esc(c2.name) : '—'}</span><b>${c2 ? esc(c2.trait) : ''}</b></div>
    <p class="hint">Характер командира части определяет манеру в эфире и чуть меняет точность в бою: решительный точнее бьёт, осторожный стабильнее, нервный — с разбросом.</p>
    ${G.vsBot ? '' : `<p class="hint">Код партии: <b class="ac">${esc(G.roomId)}</b></p>`}
  </div>`;
}

function renderBuy() {
  const rc = $('#rc');
  if (!G.price) { rc.innerHTML = '<p class="hint">Загрузка цен…</p>'; return }
  const kinds = Object.keys(G.price);
  const buying = G.pending && G.pending.startsWith('buy:') ? G.pending.slice(4) : null;
  rc.innerHTML = `<div class="card">
    <h3>Закупка</h3>
    <p class="hint">${G.phase === 'deploy' ? 'Расстановка: кликайте в своей зоне на карте (выделена).' : 'Бой: подкрепления — рядом со своей точкой.'}</p>
    <div class="shop">${kinds.map(k => {
      const price = G.price[k], off = G.budget < price;
      return `<div class="shopItem ${off ? 'off' : ''} ${buying === k ? 'on' : ''}" data-buy="${k}">
        <div class="snm"><b>${esc(KINDS[k].n)}</b><span>${esc(MODEL[k] || '')}</span></div>
        <div class="sprice">${price}</div>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function renderRight() {
  const rc = $('#rc');
  if (G.tabR === 'hq') return renderHQ();
  if (G.tabR === 'buy') return renderBuy();
  if (G.tabR === 'troops') {
    const mine = G.units.filter(u => u.side === G.side && u.hp > 0);
    rc.innerHTML = mine.map(u => `
      <div class="fl" data-id="${u.id}">
        <span class="dot" style="background:${COL[G.side]}"></span>
        <div class="nm">${esc(u.cs)}<br><span class="mu">${KINDS[u.k].n} · ${esc(MODEL[u.k] || '')}</span></div>
        <span class="mu">${Math.round(u.hp)}</span>
      </div>`).join('') || '<p class="hint">Нет живых частей.</p>';
    return;
  }
  const u = G.sel && unitById(G.sel.id);
  if (!u || u.hp <= 0 || u.side !== G.side) {
    rc.innerHTML = `<div class="card"><h3>Штаб</h3>
      <p class="hint">Выберите свою часть на карте или в списке. Клик по карте — марш.<br><br>
      <b>Пехота</b> берёт города. <b>Танки</b> ломают оборону. <b>Арта</b> бьёт издалека.
      <b>Вертолёты и штурмовики</b> — удары с воздуха. <b>Дроны</b> видят далеко.
      <b>РЭБ</b> глушит чужую точность и дроны. <b>ПВО</b> снимает воздух.</p></div>`;
    return;
  }
  const T = KINDS[u.k];
  rc.innerHTML = `<div class="card">
    <h3>«${esc(u.cs)}»</h3>
    <div class="sub">${T.n} · ${esc(MODEL[u.k] || '')} · ${u.st === 'move' ? 'марш' : u.st === 'strike' ? 'удар' : u.st === 'rtb' ? 'на базу' : 'на месте'}</div>
    <div class="row"><span>Живучесть</span><b>${Math.round(u.hp)} / ${T.hp}</b></div>
    <div class="bar"><div style="width:${100 * u.hp / T.hp}%;background:${u.hp / T.hp < .4 ? 'var(--rd)' : 'var(--gn)'}"></div></div>
    ${T.fuel ? `<div class="row"><span>Топливо</span><b>${Math.max(0, Math.round(100 * u.fuel / T.fuel))}%</b></div>` : ''}
    <div class="row"><span>Дальность</span><b>${T.rng} км</b></div>
    <div class="row"><span>Скорость</span><b>${T.sp} км/ч</b></div>
    ${T.jam ? `<div class="row"><span>Глушение</span><b>радиус ${T.jam} км</b></div>` : ''}
    ${T.cap ? `<div class="row"><span>Захват</span><b>×${T.cap}</b></div>` : '<div class="row mu"><span>Города сами не берёт</span></div>'}
    ${u.terr ? `<div class="row"><span>Местность</span><b>${esc(u.terr)}${u.terr === 'лес' || (u.terr === 'город' && u.k === 'inf') ? ' (+защита)' : u.terr === 'дорога' ? ' (+скорость)' : ''}</b></div>` : ''}
    <div class="row"><span>Командир</span><b>${esc(u.trait || '—')}</b></div>
    <div class="lbl">Приказ</div>
    <div class="acts">
      <button class="btn pri sm" data-a="move">Марш</button>
      <button class="btn sm" data-a="hold">Стоять</button>
      ${T.air ? `<button class="btn sm" data-a="rtb">На базу</button>` : ''}
      ${T.strike ? `<button class="btn sm" data-a="strike">Удар</button>` : ''}
    </div>
  </div>`;
}

let uiTick = 0;
function renderUI(force) {
  renderTop();
  if (force) renderSpeed();
  if (G.tabL === 'pts') renderPts();
  uiTick++;
  if (force || uiTick % 3 === 0) renderRight();
}

function showHelp(end) {
  const m = $('#modal');
  if (end && G.over) {
    const title = G.over.w === null ? 'Ничья' : G.over.w === G.side ? 'Победа' : 'Поражение';
    $('#mbox').innerHTML = `<h2>${title}</h2><p>${esc(G.over.t)}</p>
       <p class="acts"><button class="btn pri" id="btnNew">В меню</button></p>`;
  } else {
    $('#mbox').innerHTML = `<h2>Линия</h2>
      <p><b>Расстановка:</b> в начале партии — бюджет и зона высадки (выделена на карте). Купите части во вкладке «Закупка», кликните в зоне, нажмите «Готов» — или дождитесь таймера.</p>
      <p><b>Бой:</b> доход идёт каждую секунду (больше городов — выше доход), на него можно докупать подкрепления рядом со своей точкой. Фронт едет по захваченным городам и точкам. Пехота и мотопехота их берут, танки и арта помогают огнём.</p>
      <p><b>Воздух:</b> вертолёт держит участок, штурмовик бьёт и уходит на базу, разведдрон светит карту, ударный дрон таранит. РЭБ глушит прицельность и дроны, ПВО бьёт воздушные цели.</p>
      <p><b>Режимы:</b> Оборона — вы держите рубеж, выше доход. Наступление — больше стартового бюджета. Встречный бой — всё поровну.
      Играть можно против бота (со своим характером командования) или против другого игрока по коду партии.</p>
      <p><kbd>ЛКМ</kbd> выбрать · клик по карте — марш · колесо масштаб · перетаскивание — карта · <kbd>1–4</kbd> скорость · <kbd>Пробел</kbd> пауза</p>
      <p class="acts"><button class="btn pri" id="btnClose">Понятно</button></p>`;
  }
  m.hidden = false;
}
function hideModal() { $('#modal').hidden = true }

/* ---------- лобби/меню ---------- */
function modeCard(id, info) {
  return `<div class="mcard">
    <div class="mkick">Режим</div>
    <h2>${esc(info.title)}</h2>
    <p>${esc(info.desc)}</p>
    <div class="acts">
      <button class="btn pri sm" data-a="create" data-mode="${id}" data-bot="1">Против бота</button>
      <button class="btn sm" data-a="create" data-mode="${id}" data-bot="0">Дуэль по коду</button>
    </div>
  </div>`;
}
function menuHTML() {
  const cards = modeCard('defense', { title: 'Оборона', desc: 'Вы держите рубеж: обычный бюджет на расстановку, но выше доход от городов и точки держатся дольше. Противник получает больше стартового бюджета и наступает.' })
    + modeCard('attack', { title: 'Наступление', desc: 'Вы атакуете: бюджет на расстановку больше (+40%), чтобы ударить первым. Противник обороняется и получает больше дохода.' })
    + modeCard('both', { title: 'Встречный бой', desc: 'Бюджет и доход равны с обеих сторон, фронт решает инициатива и тактика.' });
  return `<div class="mbox">
    <h1>ЛИНИЯ</h1>
    <div class="msub">Сухопутный фронт — города, ключевые точки, бронетехника, артиллерия и авиация</div>
    <div class="mside">
      <label><input type="radio" name="mside" value="n" checked> За «${esc(SIDE_NAME.n)}» (слева)</label>
      <label><input type="radio" name="mside" value="s"> За «${esc(SIDE_NAME.s)}» (справа)</label>
    </div>
    <div class="mgrid">${cards}</div>
    <div class="mjoin">
      <span>Код партии соперника:</span>
      <input id="joinCode" maxlength="4" placeholder="ABCD" autocomplete="off" spellcheck="false">
      <button class="btn" data-a="joinCode">Войти</button>
    </div>
    <div class="mfoot">«Против бота» — бот управляет другой стороной и сам имеет характер командования.
    «Дуэль по коду» — создаёт партию и код; второй игрок входит по нему здесь же.</div>
  </div>`;
}
function showMenu() { hideModal(); $('#menu').innerHTML = menuHTML(); $('#menu').classList.add('on') }
function hideMenu() { $('#menu').classList.remove('on') }

function createGame(mode, vsBot) {
  const side = document.querySelector('input[name=mside]:checked').value;
  netSend({ t: 'create', mode, side, vsBot });
}
function joinGame(room) { netSend({ t: 'join', room: room.toUpperCase() }) }
function leaveToMenu() {
  netSend({ t: 'leave' });
  G.roomId = null; G.units = []; G.pts = []; G.over = null; G.sel = null; G.phase = null;
  $('#deployBar').hidden = true;
  hideModal(); showMenu();
}

function initMenu() {
  $('#menu').addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    if (el.dataset.a === 'create') createGame(el.dataset.mode, el.dataset.bot === '1');
    else if (el.dataset.a === 'joinCode') {
      const c = ($('#joinCode').value || '').trim();
      if (c.length === 4) joinGame(c); else toast('Код партии — четыре буквы');
    }
  });
  $('#menu').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'joinCode') $('[data-a="joinCode"]').click() });
}

/* ---------- ввод ---------- */
function pick(sp) {
  let best = null, bd = clamp(G.view.s * 9, 22, 52);
  for (const u of G.units) {
    if (u.hp <= 0) continue;
    const q = w2s(u), d = Math.hypot(q.x - sp.x, q.y - sp.y);
    if (d < bd) { bd = d; best = u }
  }
  return best;
}
function pickPt(wp) {
  let best = null, bd = 12;
  for (const p of G.pts) { const d = dist(wp, p); if (d < bd) { bd = d; best = p } }
  return best;
}

function onMapClick(sp, btn) {
  if (!G.roomId || G.over) return;
  if (btn === 2) { G.pending = null; G.sel = null; hint(''); renderUI(true); return }
  const wp = s2w(sp);
  if (G.pending && G.pending.startsWith('buy:')) {
    const kind = G.pending.slice(4);
    netSend({ t: 'buy', id: ++cmdSeq, kind, x: wp.x, y: wp.y });
    G.pending = null; hint(''); renderUI(true); return;
  }
  const hit = pick(sp);
  if (G.pending && G.sel) {
    const u = unitById(G.sel.id);
    if (u && u.hp > 0 && u.side === G.side) order(u, G.pending, wp);
    G.pending = null; hint(''); renderUI(); return;
  }
  if (hit && hit.side === G.side) {
    G.sel = { id: hit.id }; G.tabR = 'ord';
    document.querySelectorAll('#right .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === 'ord'));
    hint('Кликните по карте — марш. ПКМ — снять.');
    renderUI(); return;
  }
  if (G.sel) {
    const u = unitById(G.sel.id);
    if (u && u.hp > 0 && u.side === G.side) { order(u, 'move', wp); renderUI(); return }
  }
  const pt = pickPt(wp);
  if (pt) { G.view.x = pt.x; G.view.y = pt.y; toast(pt.n + (pt.owner === G.side ? ' — наши' : ' — противник')) }
}

/* ---------- цикл ---------- */
let last = performance.now(), uiAcc = 0;
function loop(now) {
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  interpolate(real);
  draw();
  uiAcc += real;
  if (uiAcc > 0.2) { uiAcc = 0; renderUI() }
  requestAnimationFrame(loop);
}

function bind() {
  cv = $('#map'); cx = cv.getContext('2d');
  resize(); window.addEventListener('resize', resize);

  $('#speedBox').addEventListener('click', e => {
    const b = e.target.closest('[data-sp]');
    if (!b || !G.roomId) return;
    netSend({ t: 'speed', value: +b.dataset.sp });
  });
  $('#btnHelp').onclick = () => showHelp(false);
  $('#btnMenu').onclick = () => leaveToMenu();
  $('#btnReady').onclick = () => { netSend({ t: 'ready' }); $('#btnReady').disabled = true };
  document.querySelectorAll('.colbtn').forEach(b => b.onclick = () => {
    const el = $('#' + b.dataset.col);
    el.classList.toggle('col');
    b.textContent = el.classList.contains('col') ? (b.dataset.col === 'left' ? '›' : '‹') : (b.dataset.col === 'left' ? '‹' : '›');
  });
  $('#modal').addEventListener('click', e => {
    if (e.target.id === 'btnClose' || e.target.id === 'modal') hideModal();
    if (e.target.id === 'btnNew') { hideModal(); leaveToMenu() }
  });

  document.querySelectorAll('#left .tabs button').forEach(b => b.onclick = () => {
    G.tabL = b.dataset.tab;
    document.querySelectorAll('#left .tabs button').forEach(x => x.classList.toggle('on', x === b));
    $('#lc_radio').style.display = G.tabL === 'radio' ? 'block' : 'none';
    $('#lc_pts').style.display = G.tabL === 'pts' ? 'block' : 'none';
    renderUI(true);
  });
  document.querySelectorAll('#right .tabs button').forEach(b => b.onclick = () => {
    G.tabR = b.dataset.tab;
    document.querySelectorAll('#right .tabs button').forEach(x => x.classList.toggle('on', x === b));
    renderUI(true);
  });

  $('#lc_radio').addEventListener('click', () => {});
  $('#lc_pts').addEventListener('click', e => {
    const row = e.target.closest('[data-go]');
    if (!row) return;
    const p = G.pts.find(x => x.id === row.dataset.go);
    if (p) { G.view.x = p.x; G.view.y = p.y }
  });
  $('#rc').addEventListener('click', e => {
    const buyEl = e.target.closest('[data-buy]');
    if (buyEl) {
      if (buyEl.classList.contains('off')) { toast('Не хватает бюджета'); return }
      G.pending = 'buy:' + buyEl.dataset.buy; G.sel = null;
      hint((G.phase === 'deploy' ? 'Укажите точку в своей зоне высадки.' : 'Укажите точку рядом со своей точкой.') + ' ПКМ — отмена.');
      renderUI(true); return;
    }
    const fl = e.target.closest('[data-id]');
    if (fl) {
      const u = unitById(+fl.dataset.id);
      if (u) {
        G.sel = { id: u.id }; G.tabR = 'ord'; G.view.x = u.x; G.view.y = u.y;
        document.querySelectorAll('#right .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === 'ord'));
        renderUI();
      }
      return;
    }
    const a = e.target.closest('[data-a]');
    if (!a || !G.sel) return;
    const u = unitById(G.sel.id);
    if (!u) return;
    if (a.dataset.a === 'move' || a.dataset.a === 'strike') { G.pending = 'move'; hint('Укажите точку на карте') }
    if (a.dataset.a === 'hold') order(u, 'hold');
    if (a.dataset.a === 'rtb') order(u, 'rtb');
    renderUI();
  });

  let drag = null, pan = null;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('mousedown', e => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) { pan = { x: e.clientX, y: e.clientY, vx: G.view.x, vy: G.view.y }; return }
    drag = { x: e.clientX, y: e.clientY, t: Date.now(), btn: e.button };
  });
  window.addEventListener('mousemove', e => {
    if (pan) { G.view.x = pan.vx - (e.clientX - pan.x) / G.view.s; G.view.y = pan.vy - (e.clientY - pan.y) / G.view.s; return }
    if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
      if (!pan) pan = { x: drag.x, y: drag.y, vx: G.view.x, vy: G.view.y };
      drag = null;
    }
  });
  window.addEventListener('mouseup', e => {
    if (pan) { pan = null; drag = null; return }
    if (drag && Date.now() - drag.t < 500) {
      const r = cv.getBoundingClientRect();
      onMapClick({ x: e.clientX - r.left, y: e.clientY - r.top }, drag.btn);
    }
    drag = null;
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
    const before = s2w(sp);
    G.view.s = clamp(G.view.s * (e.deltaY > 0 ? .9 : 1.1), .7, 8);
    const after = s2w(sp);
    G.view.x += before.x - after.x; G.view.y += before.y - after.y;
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (!G.roomId) return;
    if (e.code === 'Space') { e.preventDefault(); netSend({ t: 'speed', value: G.speed ? 0 : 60 }) }
    if (e.key === '1') netSend({ t: 'speed', value: 15 });
    if (e.key === '2') netSend({ t: 'speed', value: 60 });
    if (e.key === '3') netSend({ t: 'speed', value: 180 });
    if (e.key === '4') netSend({ t: 'speed', value: 600 });
    if (e.key === 'h' || e.key === 'H' || e.key === '?') showHelp(false);
  });
}

bind();
initMenu();
netConnect();
showMenu();
if (innerWidth < 960) {
  $('#left').classList.add('col');
  $('#right').classList.add('col');
}
requestAnimationFrame(loop);
