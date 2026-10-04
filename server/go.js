'use strict';
// Go rules: captures, no suicide, positional superko, Tromp-Taylor area scoring.

const EMPTY = '.', BLACK = 'b', WHITE = 'w';
const other = (c) => (c === BLACK ? WHITE : BLACK);

class Game {
  constructor(size = 9, komi = 7.5) {
    this.size = size;
    this.komi = komi;
    this.board = EMPTY.repeat(size * size);
    this.turn = BLACK;
    this.captures = { b: 0, w: 0 }; // stones captured BY each color
    this.passes = 0;
    this.moveNum = 0;
    this.lastMove = null; // {x, y} or {pass: true}
    this.history = new Set([this.board]);
    this.over = false;
    this.result = null; // {winner, reason, score}
  }

  neighbors(i) {
    const n = this.size, x = i % n, y = (i / n) | 0, out = [];
    if (x > 0) out.push(i - 1);
    if (x < n - 1) out.push(i + 1);
    if (y > 0) out.push(i - n);
    if (y < n - 1) out.push(i + n);
    return out;
  }

  // Returns {stones, liberties} for the group containing i on board b.
  group(b, i) {
    const color = b[i], stones = [i], seen = new Set([i]);
    let liberties = 0;
    const libSeen = new Set();
    for (let k = 0; k < stones.length; k++) {
      for (const j of this.neighbors(stones[k])) {
        if (b[j] === EMPTY) {
          if (!libSeen.has(j)) { libSeen.add(j); liberties++; }
        } else if (b[j] === color && !seen.has(j)) {
          seen.add(j); stones.push(j);
        }
      }
    }
    return { stones, liberties };
  }

  // Validate and apply a move. Returns {ok, error?, captured?}.
  play(color, x, y) {
    if (this.over) return { ok: false, error: 'Game is over' };
    if (color !== this.turn) return { ok: false, error: 'Not your turn' };
    const n = this.size;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n)
      return { ok: false, error: 'Off the board' };
    const i = y * n + x;
    if (this.board[i] !== EMPTY) return { ok: false, error: 'Point is occupied' };

    const b = this.board.split('');
    b[i] = color;
    const opp = other(color);
    let captured = 0;
    for (const j of this.neighbors(i)) {
      if (b[j] === opp) {
        const g = this.group(b, j);
        if (g.liberties === 0) {
          for (const s of g.stones) b[s] = EMPTY;
          captured += g.stones.length;
        }
      }
    }
    if (this.group(b, i).liberties === 0) return { ok: false, error: 'Suicide is not allowed' };
    const next = b.join('');
    if (this.history.has(next)) return { ok: false, error: 'Ko: position would repeat' };

    this.board = next;
    this.history.add(next);
    this.captures[color] += captured;
    this.turn = opp;
    this.passes = 0;
    this.moveNum++;
    this.lastMove = { x, y };
    return { ok: true, captured };
  }

  pass(color) {
    if (this.over) return { ok: false, error: 'Game is over' };
    if (color !== this.turn) return { ok: false, error: 'Not your turn' };
    this.passes++;
    this.moveNum++;
    this.lastMove = { pass: true };
    this.turn = other(color);
    if (this.passes >= 2) {
      const s = this.score();
      const winner = s.b > s.w ? BLACK : WHITE; // half-point komi: no ties
      this.finish(winner, 'score', s);
    }
    return { ok: true };
  }

  resign(color) {
    if (this.over) return { ok: false, error: 'Game is over' };
    this.finish(other(color), 'resign');
    return { ok: true };
  }

  finish(winner, reason, score = null) {
    this.over = true;
    this.result = { winner, reason, score };
  }

  // Tromp-Taylor: stones on board + empty regions bordering only that color.
  score() {
    const b = this.board, s = { b: 0, w: 0 }, seen = new Set();
    for (let i = 0; i < b.length; i++) {
      if (b[i] === BLACK) s.b++;
      else if (b[i] === WHITE) s.w++;
      else if (!seen.has(i)) {
        const region = [i], borders = new Set();
        seen.add(i);
        for (let k = 0; k < region.length; k++) {
          for (const j of this.neighbors(region[k])) {
            if (b[j] === EMPTY) { if (!seen.has(j)) { seen.add(j); region.push(j); } }
            else borders.add(b[j]);
          }
        }
        if (borders.size === 1) s[[...borders][0]] += region.length;
      }
    }
    s.w += this.komi;
    return s;
  }
}

module.exports = { Game, BLACK, WHITE, EMPTY, other };
