'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const SERVER = params.get('server') || window.TSUMEGO_SERVER;
  const SVG = 'http://www.w3.org/2000/svg';

  let ws = null;
  let retry = 0;
  let pingTimer = null;
  let current = null; // last {you, game} state
  let token = sessionStorage.getItem('tsumego.token');
  $('name').value = localStorage.getItem('tsumego.name') || '';

  function show(view) {
    for (const v of ['lobby', 'waiting', 'game']) $(v).hidden = v !== view;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else toast('Not connected to the server');
  }

  function connect() {
    $('conn').textContent = 'Connecting…';
    const url = SERVER + (token ? '/?token=' + encodeURIComponent(token) : '/');
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      $('conn').textContent = '';
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ t: 'ping' }), 25000);
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      clearInterval(pingTimer);
      const delay = Math.min(1000 * 2 ** retry++, 10000);
      $('conn').textContent = 'Disconnected. Reconnecting…';
      setTimeout(connect, delay);
    };
  }

  function onMessage(m) {
    switch (m.t) {
      case 'hello':
        token = m.token;
        sessionStorage.setItem('tsumego.token', token);
        if (!m.name) { current = null; show('lobby'); }
        break;
      case 'queued': show('waiting'); break;
      case 'left': show('lobby'); break;
      case 'state': current = m; render(m); break;
      case 'error': toast(m.msg); break;
    }
  }

  // ---- Lobby ----
  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('name').value.trim();
    if (!name) return;
    localStorage.setItem('tsumego.name', name);
    send({ t: 'join', name });
  });
  $('cancel-btn').onclick = () => send({ t: 'leave' });
  $('again-btn').onclick = () => {
    const name = $('name').value.trim() || localStorage.getItem('tsumego.name');
    if (name) send({ t: 'join', name });
    else show('lobby');
  };
  $('pass-btn').onclick = () => send({ t: 'pass' });
  $('resign-btn').onclick = () => {
    if (confirm('Resign this game?')) send({ t: 'resign' });
  };

  // ---- Game rendering ----
  const colorName = (c) => (c === 'b' ? 'Black' : 'White');

  function render({ you, game: g }) {
    show('game');
    const myTurn = !g.over && g.turn === you;

    for (const c of ['b', 'w']) {
      const p = c === 'b' ? g.black : g.white;
      const el = $(c === 'b' ? 'p-black' : 'p-white');
      el.querySelector('.pname').textContent = p.name;
      el.querySelector('.caps').textContent = g.captures[c] + ' cap';
      el.classList.toggle('me', c === you);
      el.classList.toggle('to-move', !g.over && g.turn === c);
      el.classList.toggle('offline', !p.online);
    }

    const opp = you === 'b' ? g.white : g.black;
    let status;
    if (g.over) status = 'Game over';
    else if (!opp.online) status = 'Opponent disconnected. Waiting for them to return…';
    else if (myTurn) status = g.lastMove && g.lastMove.pass ? 'Opponent passed. Your move' : 'Your move';
    else status = `Waiting for ${colorName(g.turn)}…`;
    $('status').textContent = status;

    $('pass-btn').disabled = !myTurn;
    $('resign-btn').disabled = g.over;
    drawBoard(g, you, myTurn);

    $('result').hidden = !g.over;
    if (g.over) {
      $('toast').hidden = true;
      const r = g.result;
      $('result-title').textContent = r.winner === you ? 'You win!' : 'You lose';
      const why = {
        resign: `${colorName(r.winner === 'b' ? 'w' : 'b')} resigned.`,
        disconnect: `${colorName(r.winner === 'b' ? 'w' : 'b')} left the game.`,
        score: r.score ? `Black ${r.score.b} – White ${r.score.w} (komi ${g.komi}).` : '',
      }[r.reason];
      $('result-detail').textContent = `${colorName(r.winner)} wins. ${why}`;
    }
  }

  function el(name, attrs) {
    const e = document.createElementNS(SVG, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function drawBoard(g, you, myTurn) {
    const svg = $('board');
    const n = g.size, m = 11.5, step = (100 - 2 * m) / (n - 1);
    const pos = (i) => m + i * step;
    svg.replaceChildren();
    svg.classList.toggle('my-turn', myTurn);

    const defs = el('defs', {});
    defs.innerHTML =
      '<radialGradient id="gb" cx="35%" cy="35%" r="65%"><stop offset="0" stop-color="#555"/><stop offset="1" stop-color="#111"/></radialGradient>' +
      '<radialGradient id="gw" cx="35%" cy="35%" r="65%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#cfcfcf"/></radialGradient>';
    svg.append(defs);
    svg.append(el('rect', { x: 0, y: 0, width: 100, height: 100, fill: 'var(--wood)' }));

    for (let i = 0; i < n; i++) {
      svg.append(el('line', { x1: pos(0), y1: pos(i), x2: pos(n - 1), y2: pos(i), stroke: 'var(--wood-line)', 'stroke-width': 0.3 }));
      svg.append(el('line', { x1: pos(i), y1: pos(0), x2: pos(i), y2: pos(n - 1), stroke: 'var(--wood-line)', 'stroke-width': 0.3 }));
    }
    const stars = n === 9 ? [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]] : [];
    for (const [x, y] of stars) svg.append(el('circle', { cx: pos(x), cy: pos(y), r: 0.9, fill: 'var(--wood-line)' }));

    const letters = 'ABCDEFGHJ';
    for (let i = 0; i < n; i++) {
      const t1 = el('text', { x: pos(i), y: 4.6, 'font-size': 2.6, 'text-anchor': 'middle', fill: 'var(--wood-line)' });
      t1.textContent = letters[i];
      const t2 = el('text', { x: 3.6, y: pos(i) + 0.9, 'font-size': 2.6, 'text-anchor': 'middle', fill: 'var(--wood-line)' });
      t2.textContent = n - i;
      svg.append(t1, t2);
    }

    const r = step * 0.47;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const c = g.board[y * n + x];
        const cx = pos(x), cy = pos(y);
        if (c !== '.') {
          svg.append(el('circle', {
            cx, cy, r, fill: c === 'b' ? 'url(#gb)' : 'url(#gw)',
            stroke: c === 'b' ? '#000' : '#999', 'stroke-width': 0.15,
            class: 'stone ' + (c === 'b' ? 'black' : 'white'), 'data-x': x, 'data-y': y,
          }));
          const lm = g.lastMove;
          if (lm && !lm.pass && lm.x === x && lm.y === y) {
            svg.append(el('circle', { cx, cy, r: r * 0.4, fill: 'none', stroke: c === 'b' ? '#fff' : '#000', 'stroke-width': 0.4, class: 'last' }));
          }
        } else {
          const hit = el('rect', {
            x: cx - step / 2, y: cy - step / 2, width: step, height: step, fill: 'transparent',
            class: 'pt', 'data-x': x, 'data-y': y,
            'aria-label': letters[x] + (n - y),
          });
          hit.addEventListener('click', () => {
            if (current && !current.game.over && current.game.turn === current.you) send({ t: 'move', x, y });
          });
          svg.append(hit);
          svg.append(el('circle', { cx, cy, r, fill: you === 'b' ? '#111' : '#fff', class: 'ghost' }));
        }
      }
    }
  }

  connect();
})();
