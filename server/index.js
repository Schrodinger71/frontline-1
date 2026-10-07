'use strict';
/* ============================================================
   СЕРВЕР «ЛИНИЯ»
   HTTP: раздаёт client/ и shared/. WebSocket (/ws): лобби и
   партии. Правила — в server/engine.js, у клиента только ввод
   и отрисовка снимков.

   Протокол (JSON), клиент → сервер:
     { t:'create', mode, side, vsBot }   новая партия
     { t:'join', room, side? }           войти по коду
     { t:'leave' }
     { t:'order', id, unitId, cmd, args }
     { t:'speed', value }
     { t:'buy', id, kind, x, y }          купить часть за бюджет (расстановка и подкрепления)
     { t:'ready' }                       готов закончить расстановку раньше таймера
   сервер → клиент:
     { t:'joined', room, mode, side, vsBot, seats, bots }
     { t:'snap', v:{...} }               снимок обстановки стороны
     { t:'ev', list:[...] }              события (эфир, взрывы)
     { t:'res', id, res }
     { t:'seats', seats, note }
     { t:'error', msg }
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room } = require('./room');
const { N, S } = require('../shared/world');

const ROOT = path.join(__dirname, '..');
const STATIC = [['/shared/', path.join(ROOT, 'shared')], ['/', path.join(ROOT, 'client')]];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const MODES = ['defense', 'attack', 'both'];
const rooms = new Map();
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ABC[Math.random() * CODE_ABC.length | 0];
    if (!rooms.has(c)) return c;
  }
}

function serveStatic(req, res) {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch (e) { res.writeHead(400); return res.end() }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of STATIC) {
    if (!url.startsWith(prefix)) continue;
    const file = path.join(dir, url.slice(prefix.length));
    if (!file.startsWith(dir + path.sep)) break;
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Не найдено') }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('Не найдено');
}

function createServer() {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', ws => {
    const client = {
      room: null, side: null,
      send(o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)) },
      sendRaw(s) { if (ws.readyState === 1) ws.send(s) }
    };
    const leave = () => { if (client.room) client.room.leave(client); client.room = null; client.side = null };

    ws.on('message', raw => {
      let m;
      try { m = JSON.parse(raw) } catch (e) { return }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'create') {
        if (!MODES.includes(m.mode)) return client.send({ t: 'error', msg: 'Неизвестный режим' });
        const side = m.side === S ? S : N;
        leave();
        const room = new Room(newCode(), m.mode, side, !!m.vsBot);
        rooms.set(room.id, room);
        room.join(client, side);
      } else if (m.t === 'join') {
        const room = rooms.get(String(m.room || '').toUpperCase());
        if (!room) return client.send({ t: 'error', msg: 'Партия не найдена: код неверный или она закрылась' });
        leave();
        room.join(client, m.side);
      } else if (m.t === 'leave') leave();
      else if (m.t === 'order') {
        if (!client.room) return client.send({ t: 'res', id: m.id, res: { ok: false, error: 'нет партии' } });
        client.room.order(client, m.id, m.unitId, m.cmd, m.args);
      } else if (m.t === 'speed') {
        if (client.room) client.room.speed(client, m.value);
      } else if (m.t === 'buy') {
        if (!client.room) return client.send({ t: 'res', id: m.id, res: { ok: false, error: 'нет партии' } });
        client.room.buy(client, m.id, m.kind, m.x, m.y);
      } else if (m.t === 'ready') {
        if (client.room) client.room.ready(client);
      }
    });
    ws.on('close', leave);
  });

  const sweep = setInterval(() => {
    for (const [id, r] of rooms) if (r.idle()) { r.close(); rooms.delete(id) }
  }, 30e3);
  server.on('close', () => { clearInterval(sweep); for (const r of rooms.values()) r.close(); rooms.clear(); wss.close() });
  return server;
}

module.exports = { createServer, rooms };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8081;
  createServer().listen(port, () => console.log('Линия: http://localhost:' + port));
}
