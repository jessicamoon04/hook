// Vercel serverless function: GET /api/expand?url=https://bit.ly/abc
// Asks a link-shortening service where a short link leads, and returns that address.
// The destination itself is never opened. Only the well-known shorteners below are ever contacted,
// so this can't be used to reach any other server.

// Keep in step with SHORTENERS in index.html
const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "ow.ly", "cutt.ly", "rebrand.ly", "shorturl.at",
  "tiny.cc", "rb.gy", "buff.ly", "t.ly", "s.id", "v.gd", "lnkd.in", "amzn.to"];
const MAX_HOPS = 5;

function isShortener(u) {
  return /^https?:$/.test(u.protocol) && !u.port && !u.username && !u.password &&
    SHORTENERS.includes(u.hostname.toLowerCase().replace(/^www\./, ""));
}

function answer(res, status, body, cacheSeconds) {
  // Keep in step with privacy.html, which promises answers are cached for no more than 24 hours
  if (cacheSeconds) res.setHeader("Cache-Control", "s-maxage=" + cacheSeconds);
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    answer(res, 405, { error: "Method not allowed" });
    return;
  }
  const raw = String((req.query && req.query.url) || "").trim();
  let current;
  try {
    current = new URL(raw);
  } catch (e) {
    current = null;
  }
  if (!current || raw.length > 2048 || !isShortener(current)) {
    answer(res, 400, { error: "Not a supported short link" });
    return;
  }

  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      current.protocol = "https:";
      const r = await fetch(current.href, {
        redirect: "manual",
        headers: { "user-agent": "HookCheck/1.0 (link safety checker)" },
        signal: AbortSignal.timeout(4000)
      });
      const location = r.headers.get("location");
      // Only the redirect address is needed, so the page body is never read
      try { if (r.body) await r.body.cancel(); } catch (e) { /* already closed */ }

      if (r.status < 300 || r.status > 399 || !location) {
        // Missing link, or a shortener that shows a page instead of redirecting
        answer(res, 200, { final: null }, 3600);
        return;
      }
      let next;
      try {
        next = new URL(location, current);
      } catch (e) {
        next = null;
      }
      if (!next || !/^https?:$/.test(next.protocol)) {
        answer(res, 200, { final: null }, 3600);
        return;
      }
      if (!isShortener(next)) {
        answer(res, 200, { final: next.href.slice(0, 2048) }, 86400);
        return;
      }
      current = next; // one short link pointing at another, such as t.co to bit.ly
    }
    answer(res, 200, { final: null }, 3600);
  } catch (e) {
    answer(res, 502, { error: "Lookup failed", detail: e && e.name === "TimeoutError" ? "shortener timed out" : "shortener unreachable" });
  }
};
