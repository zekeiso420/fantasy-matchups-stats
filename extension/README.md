# Matchup for YouTube TV — personal prototype

A collapsible Sleeper matchup panel on `tv.youtube.com`. YouTube TV handles playback and login; the extension supplies fantasy scores and player details.

## Install in Chrome or Edge

1. Download `public/downloads/matchup-youtube-tv.zip` and extract it.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and enable **Developer mode**.
3. Select **Load unpacked**, then select the extracted `matchup-youtube-tv` folder containing `manifest.json`.
4. Click the extension's toolbar icon to open Settings. Enter your Sleeper username and numeric league ID, then save. Leave week blank to follow the current NFL week.
5. Open or reload https://tv.youtube.com and sign in normally. Select the NFL game you are watching in the Matchup panel.

You can also install the `extension` folder from a repository checkout directly. Chrome 114+ required.

## Controls

- Left/right placement and 280/360/440px width.
- Score updates every 15/30/60 seconds while the tab is visible.
- Bench players included/excluded in a selected game.
- Scoring alerts enabled/disabled, with 0–120 seconds delay (default 3).
- Pause panel updates, remember Sleeper setup, or clear all extension data.

All starters is the default view. Click a player for league-specific scoring contributions. Positive starter gains of at least one point trigger alerts (at most one per update). The selected game and collapse state last for the browser session.

The panel follows HTML-container fullscreen. Native video-only fullscreen cannot contain it. Collapse it to reach any underlying controls. Automatic game detection and custom multiview are not part of this prototype.

## Data handling

Settings are entered on the extension's own page. Content scripts cannot directly access extension storage: local and session areas are restricted to trusted extension contexts. Sender origin, extension identity and top-level frame are checked before handling messages. The overlay cannot read or change stored Sleeper identity.

By default, the username and league ID are stored in extension session memory, cleared on browser restart/extension reload. “Remember setup” opts into local device persistence. Display preferences persist locally. Nothing uses Chrome sync. Public league and player responses are cached temporarily in worker memory; only the user's matchup and roster are sent to the overlay. No passwords, cookies, browsing history, video URLs, or watch history are collected. There is no telemetry, analytics, developer server, remote JavaScript or external font.

Requests go directly to Sleeper and ESPN, omitting cookies and referrers. These services receive normal network metadata such as IP address; Sleeper also receives the username and league identifiers requested. Fantasy data intentionally displayed in the panel is visible on the page and in screen sharing. A shadow root isolates styles, not a promise of secrecy from the host page.

“Clear all extension data” removes local and session storage, invalidates in-flight results, clears caches and resets open panels. Requests already sent cannot be recalled and may finish; their results are discarded. Removing the extension removes its local data. Disable/remove it and reload YouTube TV to remove the overlay.

## Development / validation

Run `node scripts/build-extension.mjs` after changing shared scoring code, then `python scripts/package-extension.py`. Vendor copies are checked in so ZIP installation needs no build tools. The build uses memory-only caching and cookie-free requests for the worker.

Run `node --test test/extension.test.mjs test/extension-privacy.test.mjs`.

Tests cover data shaping, settings validation, messaging boundaries, retention opt-in/revocation, clear-data behavior, and synthetic page interactions. Live Sleeper/ESPN data was successfully fetched for a real league. Signed-in YouTube TV playback and fullscreen layout still require user testing.
