// The provider URL is only correct if the *whole* path is: ESPN's scoreboard
// payload -> summarizeGames() -> PROVIDER.embedUrl(). So these tests feed team
// display names in as ESPN sends them rather than asserting on a string helper,
// and pin the result against the provider's frameable /embed/ path (its
// /player/ path serves the full website, which renders as a page in an iframe).
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeGames, TEAM_ALIAS } from '../public/nfl.js';
import { PROVIDER } from '../public/video.js';

// Shaped like a real ESPN scoreboard event.
const scoreboard = (away, home) => ({
  events: [{
    id: '401',
    date: '2026-09-20T17:00Z',
    competitions: [{
      status: { displayClock: '8:41', period: 3, type: { state: 'in', completed: false, shortDetail: '3rd 8:41' } },
      competitors: [
        { homeAway: 'home', team: home, score: '17' },
        { homeAway: 'away', team: away, score: '14' },
      ],
    }],
  }],
});

// summarizeGames keys every game by team abbreviation, after rewriting ESPN's
// abbreviation to Sleeper's (WSH -> WAS), so the lookup has to normalize too.
const urlFor = (away, home) => {
  const games = summarizeGames(scoreboard(away, home));
  const key = TEAM_ALIAS[away.abbreviation] || away.abbreviation;
  const g = games[key];
  assert.ok(g, `no game indexed under ${key}`);
  return PROVIDER.embedUrl(g);
};

test('college names produce a URL known to resolve on the provider', () => {
  // Same fixture that was confirmed live, on the frameable path.
  assert.equal(
    urlFor(
      { abbreviation: 'COLO', displayName: 'Colorado Buffaloes' },
      { abbreviation: 'GT', displayName: 'Georgia Tech Yellow Jackets' },
    ),
    'https://strmfree.st/embed/football/colorado-buffaloes-vs-georgia-tech-yellow-jackets',
  );
});

test('NFL names go through the identical path', () => {
  assert.equal(
    urlFor(
      { abbreviation: 'BAL', displayName: 'Baltimore Ravens' },
      { abbreviation: 'PIT', displayName: 'Pittsburgh Steelers' },
    ),
    'https://strmfree.st/embed/football/baltimore-ravens-vs-pittsburgh-steelers',
  );
});

test('away-vs-home order is not symmetric', () => {
  const a = { abbreviation: 'BAL', displayName: 'Baltimore Ravens' };
  const b = { abbreviation: 'PIT', displayName: 'Pittsburgh Steelers' };
  assert.notEqual(urlFor(a, b), urlFor(b, a));
  assert.equal(urlFor(b, a), 'https://strmfree.st/embed/football/pittsburgh-steelers-vs-baltimore-ravens');
});

test('digits in a team name survive slugification', () => {
  assert.equal(
    urlFor(
      { abbreviation: 'SF', displayName: 'San Francisco 49ers' },
      { abbreviation: 'LAR', displayName: 'Los Angeles Rams' },
    ),
    'https://strmfree.st/embed/football/san-francisco-49ers-vs-los-angeles-rams',
  );
});

test('the WSH -> WAS abbreviation alias never reaches the slug', () => {
  // summarizeGames rewrites WSH to WAS for Sleeper; the slug comes from the
  // display name, so neither abbreviation can leak into the URL.
  const url = urlFor(
    { abbreviation: 'WSH', displayName: 'Washington Commanders' },
    { abbreviation: 'MIN', displayName: 'Minnesota Vikings' },
  );
  assert.equal(url, 'https://strmfree.st/embed/football/washington-commanders-vs-minnesota-vikings');
  assert.ok(!url.includes('wsh') && !url.includes('was-'), url);
});

test('a missing display name falls back to the abbreviation', () => {
  assert.equal(
    urlFor({ abbreviation: 'BAL' }, { abbreviation: 'PIT' }),
    'https://strmfree.st/embed/football/bal-vs-pit',
  );
});

test('punctuation and stray whitespace collapse to single hyphens', () => {
  assert.equal(
    urlFor(
      { abbreviation: 'TAM', displayName: '  Tampa Bay  Buccaneers ' },
      { abbreviation: 'NO', displayName: "New Orleans Saints" },
    ),
    'https://strmfree.st/embed/football/tampa-bay-buccaneers-vs-new-orleans-saints',
  );
});
