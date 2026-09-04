// Minimal TTL memoizer for the browser. Not a general cache, just enough to
// avoid re-fetching the same league/user/players data on every poll tick.
const mem = new Map();

export async function memo(key, ttlMs, loader) {
  const hit = mem.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value;
  const value = await loader();
  mem.set(key, { value, expires: now + ttlMs });
  return value;
}

// Same idea but backed by localStorage, so it survives a page reload.
// Worth it only for the big, slow-changing player index (~5 MB source,
// a few hundred KB once slimmed).
export async function memoPersist(key, ttlMs, loader) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (raw && raw.expires > Date.now()) return raw.value;
  } catch { /* corrupt or missing, refetch */ }
  const value = await loader();
  try { localStorage.setItem(key, JSON.stringify({ value, expires: Date.now() + ttlMs })); } catch { /* over quota, so it just won't persist */ }
  return value;
}
