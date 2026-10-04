'use strict';
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, BLACK, WHITE } = require('./go');

const PORT = Number(process.env.PORT) || 8081;
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 60_000;
const BOARD_SIZE = 9;

// A session is a player identity that survives reconnects (via its token).
const sessions = new Map(); // token -> session
let queue = []; // sessions waiting for an opponent; queue[0] waited longest

function send(s, msg) {
  if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(msg));
}

function gameView(g) {
  const p = (c) => ({ name: g.players[c].name, online: !!g.players[c].ws });
  return {
    id: g.id, size: g.size, komi: g.komi, board: g.board, turn: g.turn,
    captures: g.captures, moveNum: g.moveNum, lastMove: g.lastMove, passes: g.passes,
    black: p(BLACK), white: p(WHITE), over: g.over, result: g.result,
  };
}

function broadcast(g, extra = {}) {
  for (const c of [BLACK, WHITE]) {
    send(g.players[c], { t: 'state', you: c, game: gameView(g), ...extra });
  }
}

function endSessionGame(s) {
  if (s.game && s.game.over) { s.game = null; s.color = null; }
}

function startGame(black, white) {
  const g = new Game(BOARD_SIZE);
  g.id = crypto.randomUUID();
  g.players = { [BLACK]: black, [WHITE]: white };
  black.game = g; black.color = BLACK;
  white.game = g; white.color = WHITE;
  console.log(`game ${g.id}: ${black.name} (B) vs ${white.name} (W)`);
  broadcast(g, { event: 'start' });
}

function finishCleanup(g) {
  for (const c of [BLACK, WHITE]) {
    const s = g.players[c];
    clearTimeout(s.graceTimer);
    if (!s.ws) sessions.delete(s.token); // gone for good
  }
  console.log(`game ${g.id} over: ${g.result.winner} by ${g.result.reason}`);
}

const handlers = {
  join(s, m) {
    const name = String(m.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!name) return send(s, { t: 'error', msg: 'Please enter a username' });
    endSessionGame(s);
    if (s.game) return send(s, { t: 'error', msg: 'You are already in a game' });
    if (queue.includes(s)) return send(s, { t: 'queued' });
    s.name = name;
    queue = queue.filter((q) => q.ws); // drop anyone who went away
    const opponent = queue.shift();
    if (opponent) startGame(opponent, s); // first in queue plays black
    else { queue.push(s); send(s, { t: 'queued' }); }
  },

  leave(s) {
    queue = queue.filter((q) => q !== s);
    send(s, { t: 'left' });
  },

  move(s, m) {
    const g = s.game;
    if (!g) return send(s, { t: 'error', msg: 'You are not in a game' });
    const r = g.play(s.color, m.x, m.y);
    if (!r.ok) return send(s, { t: 'error', msg: r.error });
    broadcast(g, { event: 'move', captured: r.captured });
  },

  pass(s) {
    const g = s.game;
    if (!g) return send(s, { t: 'error', msg: 'You are not in a game' });
    const r = g.pass(s.color);
    if (!r.ok) return send(s, { t: 'error', msg: r.error });
    broadcast(g, { event: 'pass' });
    if (g.over) finishCleanup(g);
  },

  resign(s) {
    const g = s.game;
    if (!g) return send(s, { t: 'error', msg: 'You are not in a game' });
    const r = g.resign(s.color);
    if (!r.ok) return send(s, { t: 'error', msg: r.error });
    broadcast(g, { event: 'resign' });
    finishCleanup(g);
  },

  ping(s) { send(s, { t: 'pong' }); },
};

function attach(s, ws) {
  s.ws = ws;
  ws.session = s;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, queued: queue.length, sessions: sessions.size }));
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, maxPayload: 1024 });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Resume an existing session if the client presents a live token.
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  let s = token && sessions.get(token);
  if (s && !s.ws) {
    clearTimeout(s.graceTimer);
    attach(s, ws);
    send(s, { t: 'hello', token: s.token, name: s.name });
    if (s.game) broadcast(s.game, { event: 'reconnect' });
  } else {
    s = { token: crypto.randomBytes(16).toString('hex'), name: null, ws: null, game: null, color: null };
    sessions.set(s.token, s);
    attach(s, ws);
    send(s, { t: 'hello', token: s.token });
  }

  let tokens = 20, last = Date.now();
  ws.on('message', (data) => {
    // Simple token-bucket rate limit: 10 msgs/sec, burst 20.
    const now = Date.now();
    tokens = Math.min(20, tokens + ((now - last) / 1000) * 10); last = now;
    if (tokens < 1) return; tokens--;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    const h = m && handlers[m.t];
    if (h) h(ws.session, m);
  });

  ws.on('close', () => {
    const s = ws.session;
    if (s.ws !== ws) return;
    s.ws = null;
    queue = queue.filter((q) => q !== s);
    const g = s.game;
    if (g && !g.over) {
      broadcast(g, { event: 'disconnect' });
      s.graceTimer = setTimeout(() => {
        if (s.ws || g.over) return;
        g.finish(s.color === BLACK ? WHITE : BLACK, 'disconnect');
        broadcast(g, { event: 'forfeit' });
        finishCleanup(g);
      }, RECONNECT_GRACE_MS);
    } else {
      sessions.delete(s.token);
    }
  });
});

// Drop dead sockets so disconnects are noticed promptly.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20_000).unref();

server.listen(PORT, () => console.log(`tsumego server on :${PORT}`));

module.exports = { server };
