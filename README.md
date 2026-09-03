# Matchup

Live fantasy-football matchup tracker for [Sleeper](https://sleeper.com) leagues. Enter your Sleeper username once and it remembers you, opens to your current-week matchup, and updates scores in place while games are on.

- **By position** — your starters against your opponent's, slot by slot, with the point swing per slot and each player's NFL game status.
- **By NFL game** — both rosters grouped by the real game they're playing in: live games first, then upcoming by kickoff, then finals.
- **All matchups** — every game in the league in the rail; click any to view it.
- Shareable URLs (`/?u=<username>&l=<leagueId>&w=<week>`), dark/light theme, no login (Sleeper's read API is public).

## Deploying

The app runs two ways from this one repo, and picks automatically at load time — the browser tries `/api/state` first and falls back if nothing answers:

- **With the Node server** (below): server proxies Sleeper/ESPN, computes scoring, and pushes live updates over SSE.
- **As a static site, e.g. GitHub Pages**: `public/` has no server to talk to, so the browser calls Sleeper and ESPN directly and polls for updates instead of streaming. Same UI, same scoring, same everything — just a slower refresh (10–20 s vs. instant push) since there's no server to hold a connection open.

### GitHub Pages

A workflow at `.github/workflows/deploy.yml` publishes `public/` on every push to `main` — nothing to build, it's already plain HTML/CSS/JS. One-time setup:

1. Push this repo to GitHub (`git push`, or see below if you're starting from the zip).
2. On GitHub: **Settings → Pages → Source → GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab) — it deploys in under a minute.

Want to check it works before pushing? `npm run preview:static` serves `public/` alone at `http://localhost:4000` — no `/api` routes exist, so it forces the browser into the same direct-to-Sleeper/ESPN mode Pages will use. This is the real test of the CORS caveat above, since your browser talks to `api.sleeper.app` for real, not through anything of mine.

Your site lands at `https://<username>.github.io/<repo>/`. `server.js` and `test/` stay in the repo but are never published — only `public/` goes out.

If you're starting from the zip instead of an existing clone:

```sh
git clone https://github.com/<you>/<repo>.git
cd <repo>
# copy every file from the zip in here, overwriting what's there
git add -A && git commit -m "Static-capable rewrite"
git push
```

### Node server

Requires Node 18+.

```sh
npm install
npm start          # http://localhost:3000
npm run dev        # restarts on file changes
npm run mock       # runs against fake Sleeper/ESPN data, no network needed
```

Set `PORT` to change the port. Host this anywhere that runs Node (Railway, Fly.io, Render, a VPS…) if you want the faster live-push behavior instead of polling.

## How it works

`public/nfl.js` holds the data-shaping logic (URLs, response normalizing, scoring) shared by both backends, so the server and the browser compute identical results. `server.js` is a thin Express proxy in front of Sleeper and ESPN's public endpoints built on top of it — it caches every upstream response (players for 6 h, matchups for 8 s, everything else in between), serves stale data if an upstream request fails, and trims Sleeper's ~5 MB player dump down to the handful of fields the UI needs.

`GET /stream/:leagueId/:week` is a server-sent-events feed for server mode. The server polls Sleeper and ESPN on one timer for all connected clients (every 10 s while any game is live, otherwise every 20 s) and pushes a payload only when something actually changed. In static mode, `public/backend-static.js` runs the same poll-and-diff loop from inside the browser instead, fetching Sleeper and ESPN directly — both send the CORS headers needed for this, no proxy required. The 5 MB player list is slimmed the same way and cached in `localStorage` for 6 hours so it isn't re-downloaded on every visit.

`public/backend.js` is the switch: it probes `/api/state` once at load and routes every call to whichever backend actually works. `public/app.js` never knows which one it's talking to.

### Scoring

Points are computed under **your league's `scoring_settings`** from Sleeper's per-player stat feed (`api.sleeper.com/stats/nfl/{season}/{week}`), using the shared engine in `public/scoring.js`: `Σ weight × stat` over every category the league scores, so custom, TE-premium, bonus, and IDP settings all apply. Tap any player to see the category-by-category breakdown.

- While a game is **live or upcoming**, the computed number is shown (the stats feed refreshes every 10 s during games, faster than Sleeper's matchups feed).
- Once a game is **final**, Sleeper's own `players_points` is used, so stat corrections match the app.
- If the stats feed is unavailable (it's an unofficial endpoint), everything falls back to Sleeper's matchups points.

Projected finals under the scoreboard come from Sleeper's projections run through the same scoring, blended with actual points by how much of each player's game remains.

**Caveat:** the stats/projections endpoints (`api.sleeper.com`) are unofficial and undocumented — Sleeper could change or remove them, or (in static mode specifically) their CORS headers could stop allowing direct browser calls. Everything is written to degrade rather than break if that happens: the stat sheet says "Live stat feed unavailable" and every score falls back to Sleeper's own `players_points`. Worth a first-run check either way — open the browser console after a real game goes live and confirm you're not seeing repeated fetch failures for `api.sleeper.com`.

`public/app.js` keeps all state in one object and renders from it. Live updates patch the numbers in place; if a game changes state (kickoff, final) the view re-renders so ordering and labels stay correct.

Your username, chosen league, theme, and preferred view are stored in `localStorage` under `fms:v2`. Nothing is stored server-side.
