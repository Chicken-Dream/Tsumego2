# Tsumego

Online 9×9 Go for two players. Enter a username and click **Play**; the first player in the queue plays Black and moves first, the next player to join plays White. No accounts.

Rules: captures, no suicide, positional superko, pass/resign. Two consecutive passes end the game, scored by area (Tromp-Taylor) with 7.5 komi, so dead stones must be captured before passing. A player who disconnects has 60 s to reconnect (refreshing the tab resumes the game) before forfeiting.

## Layout

- `web/` static frontend (GitHub Pages, `gh-pages` branch). Backend URL is in `web/config.js`; override with `?server=ws://localhost:8081`.
- `server/` Node WebSocket server (`ws`), in-memory state. `go.js` holds the rules.
- `deploy/` deploys the server to the shared tank-duel EC2 instance (`i-0d9750c2d5f2ecbc7`, ca-central-1) via SSM. It runs as `tsumego.service` on port 8081, and Caddy serves it at `wss://tsumego.15-156-243-42.sslip.io`.
- `test/` rules unit tests, protocol E2E tests, browser E2E test.

## Commands

```sh
cd server && npm ci && node server.js                       # local server on :8081
node --test test/go.test.js                                 # rules
TSUMEGO_URL=wss://tsumego.15-156-243-42.sslip.io node --test test/e2e.test.js
deploy/deploy-backend.sh                                    # needs AWS profile "tsumego"
git subtree push --prefix web origin gh-pages               # deploy frontend
```
