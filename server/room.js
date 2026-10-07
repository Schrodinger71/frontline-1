'use strict';
/* ============================================================
   КОМНАТА: одна партия. Тикает движок в реальном времени,
   умноженном на скорость (G.speed), и рассылает снимки по
   сторонам. Свободную сторону занимает бот, если это не дуэль.
   ============================================================ */
const { Game } = require('./engine');
const { N, S, SIDE_NAME: NAME } = require('../shared/world');

const TICK_MS = 100;
const SNAP_MS = 150;
const IDLE_MS = 10 * 60e3;
const SIDE_NAME = { n: 'сторона «' + NAME.n + '»', s: 'сторона «' + NAME.s + '»' };

class Room {
  constructor(id, mode, side, vsBot) {
    this.id = id;
    this.mode = mode;
    this.vsBot = !!vsBot;
    this.engine = new Game(mode, side);
    this.engine.bots = { n: side !== N, s: side !== S };
    if (!vsBot) this.engine.bots = { n: false, s: false };
    this.clients = new Set();
    this.emptySince = Date.now();
    this.lastTick = Date.now();
    this.lastSnap = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  seats() {
    const s = { n: 0, s: 0 };
    for (const c of this.clients) if (c.side) s[c.side]++;
    return s;
  }

  /** свободная для человека сторона: не бот и без игрока */
  freeSide() {
    const s = this.seats();
    if (!this.engine.bots.n && !s.n) return N;
    if (!this.engine.bots.s && !s.s) return S;
    return null;
  }

  join(client, wantSide) {
    const seats = this.seats();
    let side = (wantSide === N || wantSide === S) ? wantSide : null;
    if (!side || this.engine.bots[side] || seats[side]) side = this.freeSide();
    if (!side) { client.send({ t: 'error', msg: 'В этой партии уже два игрока' }); return false }
    client.room = this; client.side = side;
    this.clients.add(client);
    client.send({
      t: 'joined', room: this.id, mode: this.mode, side, vsBot: this.vsBot,
      seats: this.seats(), bots: this.engine.bots
    });
    client.sendRaw(this.snapMsg(side));
    this.broadcastSeats(client, `${SIDE_NAME[side]}: игрок подключился`);
    return true;
  }

  leave(client) {
    if (!this.clients.delete(client)) return;
    if (!this.clients.size) this.emptySince = Date.now();
    this.broadcastSeats(null, client.side ? `${SIDE_NAME[client.side]}: игрок отключился` : null);
  }

  broadcastSeats(except, note) {
    const seats = this.seats();
    for (const c of this.clients) c.send({ t: 'seats', seats, note: c === except ? null : note });
  }

  order(client, id, unitId, cmd, args) {
    let res;
    try { res = this.engine.order(client.side, unitId, cmd, args || {}) }
    catch (e) { res = { ok: false, error: 'ошибка сервера' } }
    this.dispatch(this.engine.drainEvents());
    client.send({ t: 'res', id, res });
  }

  speed(client, value) {
    this.engine.setSpeed(+value);
    this.dispatch(this.engine.drainEvents());
  }

  buy(client, id, kind, x, y) {
    let res;
    try { res = this.engine.buy(client.side, kind, +x, +y) }
    catch (e) { res = { ok: false, error: 'ошибка сервера' } }
    this.dispatch(this.engine.drainEvents());
    client.send({ t: 'res', id, res });
  }

  ready(client) {
    this.engine.markReady(client.side);
    this.dispatch(this.engine.drainEvents());
  }

  tick() {
    const now = Date.now();
    const real = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    try { this.engine.step(real, real * this.engine.speed) } catch (e) { console.error(`[${this.id}] тик:`, e) }
    this.dispatch(this.engine.drainEvents());
    if (now - this.lastSnap >= SNAP_MS) this.sendSnaps();
  }

  snapMsg(side) { return JSON.stringify({ t: 'snap', v: this.engine.snapshotFor(side) }) }

  sendSnaps() {
    this.lastSnap = Date.now();
    const cache = {};
    for (const c of this.clients) {
      const msg = cache[c.side] || (cache[c.side] = this.snapMsg(c.side));
      c.sendRaw(msg);
    }
  }

  dispatch(events) {
    if (!events.length) return;
    const per = { n: [], s: [] };
    for (const ev of events) {
      const to = ev.to === '*' ? [N, S] : [ev.to];
      for (const side of to) if (per[side]) per[side].push(ev);
    }
    for (const c of this.clients) if (c.side && per[c.side].length) c.send({ t: 'ev', list: per[c.side] });
  }

  idle() { return !this.clients.size && Date.now() - this.emptySince > IDLE_MS }
  close() { clearInterval(this.timer) }
}

module.exports = { Room };
