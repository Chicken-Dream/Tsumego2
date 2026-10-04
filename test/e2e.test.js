'use strict';
// End-to-end protocol tests against a running server.
// TSUMEGO_URL=wss://... node --test e2e.test.js   (defaults to ws://localhost:8081)
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('../server/node_modules/ws');

const URL_ = process.env.TSUMEGO_URL || 'ws://localhost:8081';
const GRACE_MS = Number(process.env.GRACE_MS) || 60_000;

class Client {
  constructor(token) {
    this.msgs = [];
    this.waiters = [];
    this.ws = new WebSocket(URL_ + '/' + (token ? '?token=' + token : ''));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d);
      this.msgs.push(m);
      if (m.t === 'hello') this.token = m.token;
      if (m.t === 'state') this.state = m;
      this.waiters = this.waiters.filter((w) => !w(m));
    });
  }
  static async open(token) {
    const c = new Client(token);
    await c.next((m) => m.t === 'hello');
    return c;
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  // Resolve with the first message (from now on) matching pred.
  next(pred, ms = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      this.waiters.push((m) => { if (pred(m)) { clearTimeout(timer); resolve(m); return true; } return false; });
    });
  }
  close() { this.ws.close(); }
}

async function match(nameA = 'Alice', nameB = 'Bob') {
  const a = await Client.open(), b = await Client.open();
  const queued = a.next((m) => m.t === 'queued');
  a.send({ t: 'join', name: nameA });
  await queued;
  const sa = a.next((m) => m.t === 'state'), sb = b.next((m) => m.t === 'state');
  b.send({ t: 'join', name: nameB });
  return { a, b, sa: await sa, sb: await sb };
}

// Make a move as `who`, wait for both players to see it.
async function move(who, other, x, y) {
  const p1 = who.next((m) => m.t === 'state' || m.t === 'error');
  const p2 = other.next((m) => m.t === 'state');
  who.send({ t: 'move', x, y });
  const r = await p1;
  assert.strictEqual(r.t, 'state', `move ${x},${y} rejected: ${r.msg}`);
  return [r, await p2];
}

test('matchmaking: first queued plays black, black moves first', async () => {
  const { a, b, sa, sb } = await match('Alice', 'Bob');
  assert.strictEqual(sa.you, 'b');
  assert.strictEqual(sb.you, 'w');
  assert.strictEqual(sa.game.black.name, 'Alice');
  assert.strictEqual(sa.game.white.name, 'Bob');
  assert.strictEqual(sa.game.turn, 'b');
  assert.strictEqual(sa.game.id, sb.game.id);
  // White cannot move first.
  const err = b.next((m) => m.t === 'error');
  b.send({ t: 'move', x: 0, y: 0 });
  assert.strictEqual((await err).msg, 'Not your turn');
  a.close(); b.close();
});

test('username is required', async () => {
  const a = await Client.open();
  const err = a.next((m) => m.t === 'error');
  a.send({ t: 'join', name: '   ' });
  assert.match((await err).msg, /username/i);
  a.close();
});

test('cancel leaves the queue', async () => {
  const a = await Client.open();
  a.send({ t: 'join', name: 'Quitter' });
  await a.next((m) => m.t === 'queued');
  a.send({ t: 'leave' });
  await a.next((m) => m.t === 'left');
  // Next two players pair with each other, not with the quitter.
  const { a: c, b: d, sa } = await match('Carol', 'Dave');
  assert.strictEqual(sa.game.black.name, 'Carol');
  a.close(); c.close(); d.close();
});

test('moving and capturing are reflected for both players', async () => {
  const { a, b } = await match();
  await move(a, b, 1, 0);           // B
  await move(b, a, 0, 0);           // W corner
  const [ra, rb] = await move(a, b, 0, 1); // B captures
  for (const s of [ra, rb]) {
    assert.strictEqual(s.game.board[0], '.', 'captured stone removed');
    assert.strictEqual(s.game.captures.b, 1);
    assert.strictEqual(s.captured, 1);
    assert.deepStrictEqual(s.game.lastMove, { x: 0, y: 1 });
  }
  // Illegal: suicide into the captured point is fine for White? (0,0) now has 2 black neighbours -> suicide.
  const err = b.next((m) => m.t === 'error');
  b.send({ t: 'move', x: 0, y: 0 });
  assert.strictEqual((await err).msg, 'Suicide is not allowed');
  a.close(); b.close();
});

test('resign: resigning player loses, opponent wins', async () => {
  const { a, b } = await match();
  await move(a, b, 4, 4);
  const ea = a.next((m) => m.t === 'state' && m.game.over);
  const eb = b.next((m) => m.t === 'state' && m.game.over);
  a.send({ t: 'resign' });
  const [fa, fb] = [await ea, await eb];
  assert.deepStrictEqual(fa.game.result, { winner: 'w', reason: 'resign', score: null });
  assert.strictEqual(fb.game.result.winner, fb.you);
  assert.notStrictEqual(fa.game.result.winner, fa.you);
  a.close(); b.close();
});

test('two passes end the game and score it', async () => {
  const { a, b } = await match();
  for (let y = 0; y < 9; y++) { await move(a, b, 4, y); await move(b, a, 5, y); }
  a.send({ t: 'pass' });
  await b.next((m) => m.t === 'state' && m.event === 'pass');
  const ea = a.next((m) => m.t === 'state' && m.game.over);
  b.send({ t: 'pass' });
  const f = await ea;
  assert.deepStrictEqual(f.game.result, { winner: 'b', reason: 'score', score: { b: 45, w: 43.5 } });
  a.close(); b.close();
});

test('play again after a game finishes', async () => {
  const { a, b } = await match('Erin', 'Frank');
  const end = b.next((m) => m.t === 'state' && m.game.over);
  a.send({ t: 'resign' });
  await end;
  // Frank queues first this time, so Frank is black.
  b.send({ t: 'join', name: 'Frank' });
  await b.next((m) => m.t === 'queued');
  const s = a.next((m) => m.t === 'state' && !m.game.over);
  a.send({ t: 'join', name: 'Erin' });
  const st = await s;
  assert.strictEqual(st.game.black.name, 'Frank');
  assert.strictEqual(st.you, 'w');
  a.close(); b.close();
});

test('reconnecting with the session token resumes the game', async () => {
  const { a, b } = await match();
  await move(a, b, 2, 2);
  const tokenA = a.token;
  const seen = b.next((m) => m.t === 'state' && m.event === 'disconnect');
  a.close();
  assert.strictEqual((await seen).game.black.online, false);
  const back = b.next((m) => m.t === 'state' && m.event === 'reconnect');
  const a2 = new Client(tokenA);
  const s = await a2.next((m) => m.t === 'state');
  assert.strictEqual(s.you, 'b');
  assert.strictEqual(s.game.board[2 * 9 + 2], 'b');
  assert.strictEqual((await back).game.black.online, true);
  await move(b, a2, 6, 6);
  a2.close(); b.close();
});

test('leaving a game for good forfeits it', { timeout: GRACE_MS + 20000 }, async () => {
  const { a, b } = await match();
  const end = b.next((m) => m.t === 'state' && m.game.over, GRACE_MS + 15000);
  a.close();
  const f = await end;
  assert.deepStrictEqual([f.game.result.winner, f.game.result.reason], ['w', 'disconnect']);
  b.close();
});
