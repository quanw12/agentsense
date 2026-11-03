// Per-source failure counter. A wrong token from one address does not lock a different address.
// Proxy headers are ignored unless trust_proxy is explicitly enabled.
const DEFAULT_LIMIT = 3;
const DEFAULT_LOCK_MS = 30 * 1000;
const MAX_SOURCES = 4096;

function source_of(request, trust_proxy) {
  if (trust_proxy && request && request.headers) {
    const header = request.headers['x-forwarded-for'];
    if (typeof header === 'string' && header.trim() !== '') {
      return `fwd:${header.split(',')[0].trim().slice(0, 80)}`;
    }
  }
  const address = request && request.socket && request.socket.remoteAddress;
  return `ip:${address || 'unknown'}`;
}

function create_limiter(options) {
  const opts = options || {};
  const limit = opts.limit || DEFAULT_LIMIT;
  const lock_ms = opts.lock_ms || DEFAULT_LOCK_MS;
  const sources = new Map();

  function prune(now) {
    if (sources.size < MAX_SOURCES) return;
    for (const [key, entry] of sources) {
      if (entry.until <= now && now - entry.seen > lock_ms) sources.delete(key);
    }
    while (sources.size > MAX_SOURCES) {
      const oldest = sources.keys().next().value;
      sources.delete(oldest);
    }
  }

  function is_locked(request, now) {
    const key = source_of(request, opts.trust_proxy === true);
    const entry = sources.get(key);
    return Boolean(entry && (now || Date.now()) < entry.until);
  }

  function note_fail(request, now) {
    const time = now || Date.now();
    const key = source_of(request, opts.trust_proxy === true);
    const entry = sources.get(key) || { count: 0, until: 0, seen: time };
    entry.seen = time;
    if (time < entry.until) {
      sources.set(key, entry);
      return entry;
    }
    entry.count += 1;
    if (entry.count >= limit) {
      entry.count = 0;
      entry.until = time + lock_ms;
    }
    sources.set(key, entry);
    prune(time);
    return entry;
  }

  function note_ok(request) {
    sources.delete(source_of(request, opts.trust_proxy === true));
  }

  return { is_locked, note_fail, note_ok, source_of: (request) => source_of(request, opts.trust_proxy === true) };
}

module.exports = { create_limiter, source_of, DEFAULT_LIMIT, DEFAULT_LOCK_MS };
