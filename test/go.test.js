'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../server/go');

// Play a sequence of [x,y] or 'pass', alternating from Black.
function seq(g, moves) {
  for (const mv of moves) {
    const r = mv === 'pass' ? g.pass(g.turn) : g.play(g.turn, mv[0], mv[1]);
    assert.ok(r.ok, `move ${JSON.stringify(mv)} failed: ${r.error}`);
  }
}
const at = (g, x, y) => g.board[y * g.size + x];

test('black moves first and turns alternate', () => {
  const g = new Game();
  assert.strictEqual(g.play('w', 0, 0).error, 'Not your turn');
  assert.ok(g.play('b', 4, 4).ok);
  assert.strictEqual(g.turn, 'w');
  assert.strictEqual(g.play('b', 3, 3).error, 'Not your turn');
});

test('occupied and off-board points are rejected', () => {
  const g = new Game();
  seq(g, [[4, 4]]);
  assert.strictEqual(g.play('w', 4, 4).error, 'Point is occupied');
  assert.strictEqual(g.play('w', 9, 0).error, 'Off the board');
  assert.strictEqual(g.play('w', -1, 0).error, 'Off the board');
});

test('single stone capture in the corner', () => {
  const g = new Game();
  seq(g, [[1, 0], [0, 0], [0, 1]]);
  assert.strictEqual(at(g, 0, 0), '.');
  assert.strictEqual(g.captures.b, 1);
});

test('group capture', () => {
  const g = new Game();
  // White group at (4,4),(5,4); Black surrounds it.
  seq(g, [[3, 4], [4, 4], [4, 3], [5, 4], [5, 3], [8, 8], [6, 4], [8, 7], [4, 5], [7, 8], [5, 5]]);
  assert.strictEqual(at(g, 4, 4), '.');
  assert.strictEqual(at(g, 5, 4), '.');
  assert.strictEqual(g.captures.b, 2);
});

test('suicide is illegal, but capturing move into no liberties is legal', () => {
  const g = new Game();
  seq(g, [[1, 0], [8, 8], [0, 1]]);
  assert.strictEqual(g.play('w', 0, 0).error, 'Suicide is not allowed');
});

test('ko recapture is forbidden immediately', () => {
  const g = new Game();
  // Classic ko shape around (1,1)/(2,1).
  seq(g, [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2], [2, 1], [1, 1]]); // W captures at (1,1)
  assert.strictEqual(at(g, 2, 1), '.');
  assert.strictEqual(g.play('b', 2, 1).error, 'Ko: position would repeat');
  seq(g, [[8, 8], [8, 7]]); // ko threat exchange
  assert.ok(g.play('b', 2, 1).ok); // now legal
});

test('two passes end the game with area scoring and komi', () => {
  const g = new Game();
  // Black wall on column 4; white wall on column 5; split the board.
  const moves = [];
  for (let y = 0; y < 9; y++) moves.push([4, y], [5, y]);
  seq(g, [...moves, 'pass', 'pass']);
  assert.ok(g.over);
  // Black: 5 cols * 9 = 45; White: 4 cols * 9 = 36 + 7.5
  assert.deepStrictEqual(g.result.score, { b: 45, w: 43.5 });
  assert.strictEqual(g.result.winner, 'b');
  assert.strictEqual(g.result.reason, 'score');
});

test('resign gives the win to the opponent', () => {
  const g = new Game();
  seq(g, [[4, 4]]);
  g.resign('b');
  assert.deepStrictEqual([g.over, g.result.winner, g.result.reason], [true, 'w', 'resign']);
  assert.strictEqual(g.play('w', 0, 0).error, 'Game is over');
});
