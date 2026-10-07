'use strict';
/* ============================================================
   ДВИЖОК ПАРТИИ «ЛИНИЯ»
   Один экземпляр Game — одна партия (комната). Вся физика и
   принятие решений — тут; клиент только рисует снимки и шлёт
   приказы. Характер командира части (trait) задаёт разброс
   точности в бою и реплики в эфире (server/phrases.js), а
   характер командования стороны (commander) — поведение бота.
   ============================================================ */
const {
  WW, WH, SIM_DT, N, S, COL, SIDE_NAME, KINDS, CS_N, CS_S, POINT_DEF,
  PRICE, START_BUDGET, DEPLOY_SEC, BASE_INCOME, INCOME_PER_WEIGHT,
  ROLE_BUDGET_MUL, ROLE_INCOME_MUL, DEPLOY_ZONE, BOT_MIX,
  TRAITS, GEN_FIRST, GEN_LAST,
  clamp, dist, mulberry, pick
} = require('../shared/world');
const { phr } = require('./phrases');
const Terrain = require('../shared/terrain');

const DAY_LIMIT = 18; /* сутки до принудительного подведения итога по перевесу */
const AGGR = {
  'решительный': { interval: 6,  push: 1.2, acc: .05,  var: 1 },
  'осторожный':  { interval: 12, push: .8,  acc: 0,    var: .55 },
  'методичный':  { interval: 9,  push: 1,   acc: .18,  var: 0 },
  'нервный':     { interval: 7,  push: 1.1, acc: -.08, var: 1.6 },
  'упрямый':     { interval: 10, push: 1,   acc: .03,  var: 1 }
};

const oppOf = s => s === N ? S : N;
const sq = p => Math.round(p.x / 10) + '-' + Math.round(p.y / 10);

class Game {
  constructor(mode, creatorSide) {
    this.mode = mode; /* 'defense' | 'attack' | 'both' */
    this.role = { n: 'both', s: 'both' };
    if (mode === 'defense') { this.role[creatorSide] = 'defender'; this.role[oppOf(creatorSide)] = 'attacker' }
    else if (mode === 'attack') { this.role[creatorSide] = 'attacker'; this.role[oppOf(creatorSide)] = 'defender' }

    this.t = 0; this.idc = 1; this.units = []; this.fx = []; this.events = [];
    this.over = null; this.speed = 60; this.bots = { n: true, s: true };
    this._ai = { n: 0, s: 0 };
    this._cs = { n: 0, s: 0 };
    this._botBuyAcc = { n: 0, s: 0 };
    this.weather = 'ясно'; this._wT = 2400 + Math.random() * 3600;
    this.rnd = mulberry(Date.now() & 0xffffffff);

    this.commanders = { n: this.makeCommander(N), s: this.makeCommander(S) };
    this.pts = POINT_DEF.map(p => ({ ...p, cap: 0, capSide: p.owner }));

    /* расстановка войск: у каждой стороны бюджет, покупка — как в Wargame */
    this.phase = 'deploy'; this.deployT = DEPLOY_SEC; this.ready = { n: false, s: false };
    this.budget = {
      n: Math.round(START_BUDGET * (ROLE_BUDGET_MUL[this.role.n] || 1)),
      s: Math.round(START_BUDGET * (ROLE_BUDGET_MUL[this.role.s] || 1))
    };
    this.income = { n: 0, s: 0 };

    this.rebuildFront();
    this.log('*', 'Штаб выделил бюджет на расстановку. Разместите части в своей зоне и нажмите «Готов».', 'hq', true);
  }

  makeCommander(side) {
    const trait = pick(this.rnd, TRAITS);
    const name = pick(this.rnd, GEN_FIRST) + ' ' + pick(this.rnd, GEN_LAST);
    return { trait, name, aggr: AGGR[trait] };
  }

  /* ---------- создание частей ---------- */
  spawn(k, side, x, y) {
    const T = KINDS[k];
    const bag = side === N ? CS_N : CS_S;
    const n = this._cs[side]++;
    const u = {
      id: this.idc++, k, side, x, y, hp: T.hp, dest: null, st: 'ready',
      cs: bag[n % bag.length] + '-' + (11 + (n * 7) % 88),
      trait: pick(this.rnd, TRAITS),
      home: { x, y }, fuel: T.fuel || 0, am: k === 'art' || k === 'jet' || k === 'atkd' ? 12 : 99,
      cd: 0, hd: side === N ? Math.PI / 2 : -Math.PI / 2, trail: []
    };
    this.units.push(u);
    return u;
  }

  /* ---------- экономика: бюджет, покупка подкреплений, расстановка ---------- */
  inOwnDeployZone(side, x, y) {
    const z = DEPLOY_ZONE[side];
    return x >= z.x0 && x <= z.x1 && y >= 4 && y <= WH - 4;
  }
  inOwnTerritory(side, x, y) {
    return this.pts.some(p => p.owner === side && dist({ x, y }, p) < 24);
  }
  buy(side, kind, x, y) {
    if (!PRICE[kind]) return { ok: false, error: 'неизвестный тип части' };
    const price = PRICE[kind];
    if (this.budget[side] < price) return { ok: false, error: 'не хватает бюджета' };
    const zoneOk = this.phase === 'deploy' ? this.inOwnDeployZone(side, x, y) : this.inOwnTerritory(side, x, y);
    if (!zoneOk) return { ok: false, error: this.phase === 'deploy' ? 'можно только в своей зоне высадки' : 'можно только рядом со своей точкой' };
    this.budget[side] -= price;
    const u = this.spawn(kind, side, clamp(x, 4, WW - 4), clamp(y, 4, WH - 4));
    this.log(side, `«${u.cs}» (${KINDS[kind].n}) в строю.`, 'g');
    return { ok: true };
  }
  markReady(side) { if (this.phase === 'deploy') this.ready[side] = true }

  economyTick(dt) {
    for (const side of [N, S]) {
      const w = this.pts.filter(p => p.city && p.owner === side).reduce((s, p) => s + p.w, 0);
      const mul = ROLE_INCOME_MUL[this.role[side]] || 1;
      this.income[side] = (BASE_INCOME + w * INCOME_PER_WEIGHT) * mul;
      this.budget[side] += this.income[side] * dt;
    }
  }

  /** бот тратит бюджет на расстановке в своей зоне, потом выставляет готовность */
  botDeployTick(side, realDt) {
    if (!this.bots[side]) return;
    this._botBuyAcc[side] += realDt;
    if (this._botBuyAcc[side] >= .4) {
      this._botBuyAcc[side] = 0;
      const kind = pick(this.rnd, BOT_MIX);
      if (this.budget[side] >= PRICE[kind]) {
        const z = DEPLOY_ZONE[side];
        this.buy(side, kind, z.x0 + this.rnd() * (z.x1 - z.x0), 20 + this.rnd() * (WH - 40));
      }
    }
    if (this.deployT < DEPLOY_SEC * .15) this.ready[side] = true;
  }
  /** бот покупает подкрепления во время боя — рядом со своей случайной точкой */
  botBuyTick(dt) {
    for (const side of [N, S]) {
      if (!this.bots[side]) continue;
      this._botBuyAcc[side] += dt;
      if (this._botBuyAcc[side] < 5) continue;
      this._botBuyAcc[side] = 0;
      const kind = pick(this.rnd, BOT_MIX);
      if (this.budget[side] < PRICE[kind]) continue;
      const own = this.pts.filter(p => p.owner === side);
      if (!own.length) continue;
      const p = own[Math.floor(this.rnd() * own.length)];
      this.buy(side, kind, p.x + (this.rnd() - .5) * 20, p.y + (this.rnd() - .5) * 20);
    }
  }
  beginBattle() {
    this.phase = 'battle';
    this.log('*', 'Расстановка окончена. Начало боевых действий.', 'hq', true);
  }

  /* ---------- события к клиентам ---------- */
  log(to, text, cls, hq, cs) {
    this.events.push({ type: 'log', to, t: this.t, text, cls: cls || '', hq: !!hq, cs: cs || null });
  }
  fxPush(kind, x, y, air) {
    this.events.push({ type: 'fx', to: '*', kind, x, y, air: !!air });
  }
  drainEvents() { const e = this.events; this.events = []; return e; }

  /* ---------- геометрия фронта ---------- */
  jamAt(p, side) {
    let j = 0;
    for (const u of this.units) {
      if (u.hp <= 0 || u.side === side || !KINDS[u.k].jam) continue;
      const d = dist(u, p);
      if (d < KINDS[u.k].jam) j = Math.max(j, 1 - d / KINDS[u.k].jam);
    }
    return j;
  }
  influence(x, y) {
    let v = 0;
    for (const p of this.pts) {
      const dx = x - p.x, dy = y - p.y;
      const inf = (p.city ? 2.4 : 1) * p.w / (dx * dx + dy * dy + 110);
      v += p.owner === N ? inf : -inf;
    }
    for (const u of this.units) {
      if (u.hp <= 0 || KINDS[u.k].air) continue;
      const d2 = (x - u.x) ** 2 + (y - u.y) ** 2 + 160;
      v += (u.side === N ? 1 : -1) * 0.12 * (KINDS[u.k].cap + .3) / d2 * 40;
    }
    return v;
  }
  /** линия фронта вертикальная: для каждого y ищем x, где влияние меняет знак (запад слева, восток справа) */
  rebuildFront() {
    const xs = [];
    for (let y = 0; y <= WH; y += 6) {
      let lo = 10, hi = WW - 10;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (this.influence(mid, y) > 0) lo = mid; else hi = mid;
      }
      xs.push({ x: (lo + hi) / 2, y });
    }
    this.frontY = xs;
  }

  /* ---------- видимость (только для показа людям, бой на неё не смотрит) ---------- */
  canSee(viewer, tgt) {
    const T = KINDS[viewer.k];
    let vis = T.vis * (1 - this.jamAt(viewer, viewer.side) * .6);
    if (KINDS[tgt.k].air) vis *= 1.15;
    return dist(viewer, tgt) < vis;
  }
  sideSees(side, u) {
    if (u.side === side) return true;
    return this.units.some(v => v.hp > 0 && v.side === side && this.canSee(v, u));
  }

  /* ---------- местность: лес/город — защита, дорога — скорость ---------- */
  inCityArea(p) {
    for (const c of this.pts) if (c.city && dist(p, c) < c.w * 2.2 + 4) return true;
    return false;
  }
  /** множитель, на который делится входящий урон (защита местности) */
  terrainDef(u) {
    if (KINDS[u.k].air) return 1;
    const forest = Terrain.isForest(u.x, u.y, WH);
    const city = this.inCityArea(u);
    if (u.k === 'inf') return (forest || city) ? 1.5 : 1;
    return forest ? 1.25 : 1;
  }
  onRoad(u) { return !KINDS[u.k].air && Terrain.onRoad(u.x, u.y, POINT_DEF) }

  /* ---------- приказы ---------- */
  order(side, unitId, cmd, payload) {
    const u = this.units.find(x => x.id === unitId && x.side === side && x.hp > 0);
    if (!u) return { ok: false, error: 'нет такой части' };
    const T = KINDS[u.k];
    if (cmd === 'move') {
      const x = clamp(+payload.x, 4, WW - 4), y = clamp(+payload.y, 4, WH - 4);
      u.dest = { x, y }; u.st = T.strike ? 'strike' : 'move';
      const key = T.strike ? 'strike' : T.air ? 'moveAir' : 'move';
      this.log(side, phr(key, { sq: sq({ x, y }) }, u), '', false, u.cs);
      return { ok: true };
    }
    if (cmd === 'hold') {
      u.dest = null; u.st = 'ready';
      this.log(side, phr('hold', {}, u), '', false, u.cs);
      return { ok: true };
    }
    if (cmd === 'rtb') {
      if (!T.air) return { ok: false, error: 'эта часть не летает' };
      u.dest = { ...u.home }; u.st = 'rtb';
      this.log(side, phr('rtb', {}, u), '', false, u.cs);
      return { ok: true };
    }
    return { ok: false, error: 'неизвестный приказ' };
  }
  setSpeed(v) { if ([0, 15, 60, 180, 600].includes(v)) this.speed = v; }

  /* ---------- бой ---------- */
  nearestEnemy(u) {
    let best = null, bd = 1e9;
    const T = KINDS[u.k];
    for (const e of this.units) {
      if (e.hp <= 0 || e.side === u.side) continue;
      const ea = KINDS[e.k].air;
      if (T.vs === 'g' && ea) continue;
      if (T.vs === 'a' && !ea) continue;
      const d = dist(u, e);
      if (d < bd) { bd = d; best = e }
    }
    return best;
  }

  applyDmg(e, dmg, src) {
    e.hp -= dmg;
    this.fxPush('hit', e.x, e.y, KINDS[e.k].air);
    if (e.hp <= 0) {
      e.hp = 0; e.st = 'dead';
      this.fxPush('boom', e.x, e.y, KINDS[e.k].air);
      if (src) this.log(src.side, phr('hit', { lb: KINDS[e.k].sh }, src), 'g', false, src.cs);
      this.log(e.side, phr('lost', {}, e), 'w', false, e.cs);
    }
  }

  fight(u, dt, aggr) {
    const T = KINDS[u.k];
    if (u.cd > 0) { u.cd -= dt; return }
    const jam = this.jamAt(u, u.side);
    const tgt = this.nearestEnemy(u);
    if (!tgt) return;
    const d = dist(u, tgt);
    if (d > T.rng) return;
    if (T.kamikaze) {
      this.log(u.side, phr('kamikaze', {}, u), 'q', false, u.cs);
      this.applyDmg(tgt, T.atk * (1 - jam * .5) / this.terrainDef(tgt), u);
      this.applyDmg(u, 999, u);
      return;
    }
    const base = .55 + Math.random() * .45;
    const acc = clamp(base + aggr.acc, .15, 1) * (1 - jam * .7);
    let dmg = T.atk * acc * (dt / 8) / ((KINDS[tgt.k].arm || 1) * this.terrainDef(tgt));
    if ((tgt.k === 'uav' || tgt.k === 'atkd') && this.jamAt(tgt, tgt.side) > .25) dmg *= 1.5;
    this.applyDmg(tgt, dmg, u);
    if (T.splash) for (const e of this.units) {
      if (e === tgt || e.hp <= 0 || e.side === u.side) continue;
      if (dist(e, tgt) < T.splash) this.applyDmg(e, dmg * .45 / this.terrainDef(e), u);
    }
    u.cd = T.air ? 4 : (u.k === 'art' ? 12 : 3);
    if (u.k === 'art' && Math.random() < .08) this.log(u.side, phr('fire', {}, u), '', false, u.cs);
  }

  moveUnit(u, dt) {
    const T = KINDS[u.k];
    if (T.fuel) {
      if (u.st !== 'ready' || u.dest) u.fuel -= dt;
      if (u.fuel <= 0) { u.fuel = 0; if (u.st !== 'rtb') { u.dest = { ...u.home }; u.st = 'rtb' } }
      if (u.st === 'rtb' && dist(u, u.home) < 3) {
        u.fuel = T.fuel; u.dest = null; u.st = 'ready';
        this.log(u.side, phr('landed', {}, u), 'g', false, u.cs);
      }
    }
    if (!u.dest) return;
    const d = dist(u, u.dest);
    const enemy = this.nearestEnemy(u);
    const inRangeFight = enemy && dist(u, enemy) <= T.rng * (T.air ? .85 : .7);
    if (!T.air && inRangeFight && u.k !== 'art') return;
    if (d < 1.2) {
      if (T.strike && u.st === 'strike') {
        for (const e of this.units) {
          if (e.hp <= 0 || e.side === u.side) continue;
          if (dist(e, u) < 10) this.applyDmg(e, T.atk * (.6 + Math.random() * .5) / this.terrainDef(e), u);
        }
        this.fxPush('boom', u.x, u.y, true);
        this.log(u.side, phr('strikeDone', {}, u), 'g', false, u.cs);
        u.dest = { ...u.home }; u.st = 'rtb';
        return;
      }
      u.dest = null; u.st = 'ready';
      if (!T.air) this.log(u.side, phr('arrive', {}, u), '', false, u.cs);
      return;
    }
    const sp = T.sp / 3600 * dt * (this.onRoad(u) ? 1.6 : 1);
    const k = Math.min(1, sp / d);
    u.hd = Math.atan2(u.dest.y - u.y, u.dest.x - u.x);
    u.x += (u.dest.x - u.x) * k;
    u.y += (u.dest.y - u.y) * k;
    if (T.air) { u.trail.push(u.x, u.y); if (u.trail.length > 48) u.trail.splice(0, 2) }
  }

  capture(dt) {
    for (const p of this.pts) {
      let n = 0, s = 0;
      for (const u of this.units) {
        if (u.hp <= 0 || KINDS[u.k].air || !KINDS[u.k].cap || dist(u, p) > 11) continue;
        if (u.side === N) n += KINDS[u.k].cap; else s += KINDS[u.k].cap;
      }
      const lead = n - s;
      if (Math.abs(lead) < .05) continue;
      const side = lead > 0 ? N : S;
      let rate = Math.min(8, Math.abs(lead)) * dt * .35;
      if (this.role[oppOf(side)] === 'defender') rate *= .7; /* бонус обороны: держат точки дольше */
      if (p.owner === side) { p.cap = Math.max(0, p.cap - rate); continue }
      p.cap += rate; p.capSide = side;
      if (p.cap >= 100) {
        p.owner = side; p.cap = 0;
        this.log(side, phr('captured', { n: p.n }, null), 'g', true);
        this.log(oppOf(side), phr('lostPoint', { n: p.n }, null), 'crit', true);
        this.rebuildFront();
      }
    }
  }

  /* ---------- бот ---------- */
  ai(side, dt) {
    if (!this.bots[side]) return;
    const com = this.commanders[side];
    this._ai[side] = (this._ai[side] || 0) + dt;
    if (this._ai[side] < com.aggr.interval) return;
    this._ai[side] = 0;
    const role = this.role[side];
    const enemy = oppOf(side);
    const enemyPts = this.pts.filter(p => p.owner === enemy || p.capSide === side);
    const ownPts = this.pts.filter(p => p.owner === side);
    const front = this.frontY[Math.floor(this.frontY.length / 2)] || { x: WW / 2 };
    for (const u of this.units) {
      if (u.side !== side || u.hp <= 0) continue;
      if (u.dest && dist(u, u.dest) > 8) continue;
      const T = KINDS[u.k];
      if (T.fuel && u.fuel < T.fuel * .25) { u.dest = { ...u.home }; u.st = 'rtb'; continue }
      if (T.strike) {
        const t = enemyPts[Math.floor(Math.random() * Math.max(1, enemyPts.length))] || this.pts[6];
        u.dest = { x: clamp(t.x + (Math.random() - .5) * 12, 4, WW - 4), y: clamp(t.y + (Math.random() - .5) * 8, 4, WH - 4) };
        u.st = 'strike'; continue;
      }
      if (u.k === 'art' || u.k === 'aa' || u.k === 'ew') {
        const dx = role === 'defender' ? 10 : 18;
        u.dest = { x: clamp(side === N ? front.x - dx - Math.random() * 10 : front.x + dx + Math.random() * 10, 4, WW - 4), y: clamp(u.y + (Math.random() - .5) * 20, 4, WH - 4) };
        u.st = 'move'; continue;
      }
      if (T.air && u.k === 'uav') {
        const t = this.pts[Math.floor(Math.random() * this.pts.length)];
        u.dest = { x: t.x, y: t.y }; u.st = 'move'; continue;
      }
      if (role === 'defender') {
        /* держим рубеж: реагируем только если враг рядом со своей точкой */
        let threat = null, td = 1e9;
        for (const p of ownPts) {
          for (const e of this.units) {
            if (e.hp <= 0 || e.side === side || KINDS[e.k].air) continue;
            const d = dist(e, p);
            if (d < 26 && d < td) { td = d; threat = p }
          }
        }
        const t = threat || ownPts.sort((a, b) => dist(u, a) - dist(u, b))[0];
        if (t && dist(u, t) > 6) { u.dest = { x: t.x + (Math.random() - .5) * 8, y: t.y + (Math.random() - .5) * 8 }; u.st = 'move' }
        continue;
      }
      const prey = enemyPts.concat(ownPts.filter(p => p.cap > 0));
      const t = prey.sort((a, b) => dist(u, a) - dist(u, b))[0];
      if (t) { u.dest = { x: t.x + (Math.random() - .5) * 8, y: t.y + (Math.random() - .5) * 8 }; u.st = 'move' }
    }
  }

  /* ---------- погода (визуальный эффект + немного на видимость/точность) ---------- */
  weatherTick(dt) {
    this._wT -= dt;
    if (this._wT > 0) return;
    this._wT = 2400 + Math.random() * 4800;
    this.weather = pick(this.rnd, ['ясно', 'ясно', 'облачно', 'туман', 'дождь']);
  }

  checkEnd() {
    if (this.over) return;
    const cities = this.pts.filter(p => p.city);
    const nc = cities.filter(p => p.owner === N).length;
    const nAlive = this.units.some(u => u.side === N && u.hp > 0);
    const sAlive = this.units.some(u => u.side === S && u.hp > 0);
    if (nc === cities.length) this.over = { w: N, t: `Все города под стороной «${SIDE_NAME[N]}». Фронт прорван.` };
    else if (nc === 0) this.over = { w: S, t: `Города потеряны стороной «${SIDE_NAME[N]}». Фронт рухнул.` };
    else if (!nAlive) this.over = { w: S, t: `Сторона «${SIDE_NAME[N]}» выбита.` };
    else if (!sAlive) this.over = { w: N, t: `Сторона «${SIDE_NAME[S]}» сломлена.` };
    else if (this.t >= DAY_LIMIT * 86400) {
      const sc = cities.filter(p => p.owner === S).length;
      this.over = nc === sc ? { w: null, t: 'Срок операции истёк. Ничья по городам.' }
        : { w: nc > sc ? N : S, t: 'Срок операции истёк. Перевес по городам решил исход.' };
    }
    if (this.over) { this.speed = 0; this.log('*', this.over.t, this.over.w ? (this.over.w === N ? 'g' : 'crit') : '', true) }
  }

  step(realDt, simDt) {
    if (this.over) return;
    if (this.phase === 'deploy') {
      this.deployT -= realDt;
      for (const side of [N, S]) this.botDeployTick(side, realDt);
      const okN = this.bots.n || this.ready.n, okS = this.bots.s || this.ready.s;
      if (this.deployT <= 0 || (okN && okS)) this.beginBattle();
      return;
    }
    const dt = simDt;
    this.t += dt;
    this.weatherTick(dt);
    this.economyTick(dt);
    this.botBuyTick(realDt);
    for (const side of [N, S]) this.ai(side, dt);
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      if ((u.k === 'uav' || u.k === 'atkd') && this.jamAt(u, u.side) > .4) {
        u.hp -= dt * .35;
        if (u.hp <= 0) { u.hp = 0; u.st = 'dead'; this.log(u.side, phr('lost', {}, u), 'w', false, u.cs) }
      }
      if (u.hp > 0) {
        this.moveUnit(u, dt);
        const aggr = this.commanders[u.side].aggr;
        this.fight(u, dt, { acc: aggr.acc * .3 });
      }
    }
    this.capture(dt);
    if (Math.floor(this.t / 20) !== Math.floor((this.t - dt) / 20)) this.rebuildFront();
    this.units = this.units.filter(u => u.hp > 0);
    this.checkEnd();
  }

  /* ---------- снимок для стороны ---------- */
  snapshotFor(side) {
    const units = this.units.map(u => {
      const mine = u.side === side;
      if (!mine && !this.sideSees(side, u)) return null;
      const terr = mine && !KINDS[u.k].air
        ? (Terrain.isForest(u.x, u.y, WH) ? 'лес' : this.inCityArea(u) ? 'город' : this.onRoad(u) ? 'дорога' : 'поле')
        : null;
      return {
        id: u.id, k: u.k, side: u.side, x: u.x, y: u.y, hp: u.hp, dest: u.dest, st: u.st,
        cs: u.cs, fuel: u.fuel, am: u.am, hd: u.hd, trait: mine ? u.trait : null, terr
      };
    }).filter(Boolean);
    return {
      side, mode: this.mode, role: this.role, t: this.t, speed: this.speed, over: this.over,
      weather: this.weather, commanders: this.commanders,
      phase: this.phase, deployT: Math.max(0, this.deployT), ready: this.ready,
      budget: Math.round(this.budget[side]), income: +this.income[side].toFixed(1),
      deployZone: DEPLOY_ZONE[side], price: PRICE,
      pts: this.pts, frontY: this.frontY, units
    };
  }
}

module.exports = { Game };
