# In-video player rails

Theater Single displays game-filtered player rails above the existing stream.
The roster tables are unchanged. Multi tiles have no rails; scoring flashes are
not implemented. Mouse activity shows the rails for three seconds. Selection
pins them; leaving the video dismisses immediately. Keyboard arrows move between
faces, Enter/Space selects, and Escape dismisses the strip. Touch keeps the faces
visible. Six faces fit per side before scrolling, with no visible scrollbar.

The stream is a cross-origin iframe, so its mouse events cannot bubble into the
page. While rails are enabled the wrapper receives pointer events. The **Stream
controls** button under the picture switches pointer input back to the provider
and hides the rails. Turn it off to use the rails again. The frame is not reloaded.

`rail-data.js` creates six ordered stat cells for each position in the data
adapter. The renderer has no position-specific stat tables. Missing feeds and
unavailable projections use an em dash. Live ticks carry the prepared rail
records in `scored.players[id].rail`, avoiding separate per-game polling and
keeping points synchronized with the score bar. GitHub Pages uses the same
formatter in its static backend.

The Node server also exposes:

```
GET /api/matchup/:matchupId/game/:gameId/players?leagueId=...&week=...&rosterId=...
```

League, week, and viewing roster context are required because Sleeper matchup
IDs repeat across leagues and weeks. The response is `{ mine: Player[], opp:
Player[] }`, with `bench` and `fallbackUrl` added to the requested Player shape.
This endpoint is available when running the Node server, not on GitHub Pages.
