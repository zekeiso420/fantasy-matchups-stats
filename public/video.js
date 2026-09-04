// Video provider config, shared by the client and the tests.
// VIDEO_PATH must be `embed`, not `player`: /player/ is the site's own page
// (nav, chrome, ~104KB) and framing it renders the whole website, while /embed/
// is the bare player and is the only one that sends X-Frame-Options: ALLOWALL.
// The path is `/{path}/{sport}/{away}-vs-{home}`, where each
// team is its full name slugified: "kansas-city-chiefs", not "kc". ESPN gives
// us those names on the scoreboard, so teamSlug() prefers the name and falls
// back to the abbreviation when one is missing. Point VIDEO_BASE / VIDEO_PATH
// at any provider you have the right to embed.
export const VIDEO_BASE = 'https://strmfree.st';
export const VIDEO_PATH = 'embed';
export const VIDEO_SPORT = 'football';

export const teamSlug = (name, abbr) => (name || abbr || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const PROVIDER = {
  name: 'strmfree',
  embedUrl: (g) =>
    `${VIDEO_BASE}/${VIDEO_PATH}/${VIDEO_SPORT}/${teamSlug(g.awayName, g.away)}-vs-${teamSlug(g.homeName, g.home)}`,
};
