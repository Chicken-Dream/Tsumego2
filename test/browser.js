'use strict';
// Browser E2E: two real players through the UI.
// SITE=https://chicken-dream.github.io/Tsumego2/ node test/browser.js   (needs `playwright` resolvable)
const { chromium } = require('playwright');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const SITE = process.env.SITE || 'https://chicken-dream.github.io/Tsumego2/';
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const step = (s) => console.log('✓', s);
const pt = (x, y) => `#board rect.pt[data-x="${x}"][data-y="${y}"]`;
const stone = (x, y) => `#board circle.stone[data-x="${x}"][data-y="${y}"]`;

(async () => {
  const browser = await chromium.launch();
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 520, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    page.on('pageerror', (e) => { throw e; });
    await page.goto(SITE);
    return page;
  };
  const A = await mk(), B = await mk();
  const text = (p, sel) => p.locator(sel).innerText();

  // Matchmaking
  await A.fill('#name', 'Alice');
  await A.click('#play-btn');
  await A.waitForSelector('#waiting:not([hidden])');
  step('Alice is queued and waiting');
  await A.screenshot({ path: path.join(SHOTS, '1-waiting.png') });

  await B.fill('#name', 'Bob');
  await B.click('#play-btn');
  await Promise.all([A.waitForSelector('#game:not([hidden])'), B.waitForSelector('#game:not([hidden])')]);
  assert.strictEqual(await text(A, '#p-black .pname'), 'Alice');
  assert.strictEqual(await text(A, '#p-white .pname'), 'Bob');
  assert.ok(await A.locator('#p-black.me').count());
  assert.ok(await B.locator('#p-white.me').count());
  assert.strictEqual(await text(A, '#status'), 'Your move');
  assert.match(await text(B, '#status'), /Waiting for Black/);
  step('Matched: Alice is Black and moves first, Bob is White');

  // Moving
  await A.click(pt(1, 0));
  await B.waitForSelector(stone(1, 0) + '.black');
  assert.strictEqual(await text(B, '#status'), 'Your move');
  await B.click(pt(0, 0));
  await A.waitForSelector(stone(0, 0) + '.white');
  step('Moves appear on both boards and the turn alternates');
  await A.screenshot({ path: path.join(SHOTS, '2-before-capture.png') });

  // Capturing
  await A.click(pt(0, 1));
  for (const p of [A, B]) {
    await p.waitForSelector(stone(0, 1) + '.black');
    await p.waitForSelector(stone(0, 0), { state: 'detached' });
    assert.strictEqual(await text(p, '#p-black .caps'), '1 cap');
  }
  step('Black captures the corner stone; it disappears for both and the capture count updates');
  await B.screenshot({ path: path.join(SHOTS, '3-after-capture.png') });

  // Illegal move feedback
  await B.click(pt(0, 0));
  await B.waitForSelector('#toast:not([hidden])');
  assert.strictEqual(await text(B, '#toast'), 'Suicide is not allowed');
  step('Illegal suicide move is rejected with a message');

  // Win/lose by resignation
  await B.click(pt(4, 4));
  await A.waitForSelector(stone(4, 4));
  await A.click('#resign-btn');
  await Promise.all([A.waitForSelector('#result:not([hidden])'), B.waitForSelector('#result:not([hidden])')]);
  assert.strictEqual(await text(A, '#result-title'), 'You lose');
  assert.strictEqual(await text(B, '#result-title'), 'You win!');
  assert.match(await text(B, '#result-detail'), /White wins\. Black resigned/);
  step('Alice resigns: Alice sees "You lose", Bob sees "You win!"');
  await B.screenshot({ path: path.join(SHOTS, '4-win.png') });
  await A.screenshot({ path: path.join(SHOTS, '5-lose.png') });

  // Rematch: Bob queues first, so Bob is Black. Then win/lose on score.
  await B.click('#again-btn');
  await B.waitForSelector('#waiting:not([hidden])');
  await A.click('#again-btn');
  await A.waitForSelector('#result', { state: 'hidden' });
  await A.waitForFunction(() => document.querySelector('#p-black .pname').textContent === 'Bob');
  assert.ok(await B.locator('#p-black.me').count());
  step('Play again: Bob queued first, so Bob is Black in the rematch');

  await B.click(pt(2, 2));
  await A.waitForSelector(stone(2, 2));
  await A.click(pt(6, 6));
  await B.waitForSelector(stone(6, 6));
  await B.click('#pass-btn');
  await A.waitForFunction(() => document.querySelector('#status').textContent === 'Opponent passed. Your move');
  await A.click('#pass-btn');
  await Promise.all([A.waitForSelector('#result:not([hidden])'), B.waitForSelector('#result:not([hidden])')]);
  // One stone each, no territory: Black 1, White 1 + 7.5 komi.
  assert.strictEqual(await text(A, '#result-title'), 'You win!');
  assert.strictEqual(await text(B, '#result-title'), 'You lose');
  assert.match(await text(A, '#result-detail'), /Black 1 – White 8\.5/);
  step('Both pass: game is scored (White 8.5 vs Black 1), Alice wins, Bob loses');
  await A.screenshot({ path: path.join(SHOTS, '6-score.png') });

  await browser.close();
  console.log('Browser E2E passed');
})().catch((e) => { console.error(e); process.exit(1); });
