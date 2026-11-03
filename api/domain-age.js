// Vercel serverless function: GET /api/domain-age?domain=example.com
// Looks up a domain's registration date through RDAP (the public successor to WHOIS).
// It asks the registry for the domain's ending directly, found through IANA's official RDAP list,
// and falls back to rdap.org for endings that list doesn't cover or when the registry doesn't answer.
// Always answers 200 for a valid domain so the page can tell "no record" apart from "no API here".

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const DAY_MS = 24 * 60 * 60 * 1000;

// Kept between requests while the function stays warm; refreshed daily
let bootstrap = null;

async function registryFor(tld) {
  if (!bootstrap || Date.now() - bootstrap.fetchedAt > DAY_MS) {
    const r = await fetch(BOOTSTRAP_URL, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error("bootstrap " + r.status);
    const data = await r.json();
    const map = {};
    for (const [tlds, urls] of data.services || []) {
      const url = urls.find((u) => u.startsWith("https://")) || urls[0];
      if (!url) continue;
      for (const t of tlds) map[t.toLowerCase()] = url.endsWith("/") ? url : url + "/";
    }
    bootstrap = { fetchedAt: Date.now(), map };
  }
  return bootstrap.map[tld] || null;
}

module.exports = async function handler(req, res) {
  const domain = String((req.query && req.query.domain) || "").trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || domain.length > 253) {
    res.status(400).json({ error: "Invalid domain" });
    return;
  }

  let base = null;
  try {
    base = await registryFor(domain.split(".").pop());
  } catch (e) {
    base = null;
  }

  const sources = [];
  if (base) sources.push(base + "domain/" + encodeURIComponent(domain));
  sources.push("https://rdap.org/domain/" + encodeURIComponent(domain));

  let lastError = "no answer";
  for (const url of sources) {
    try {
      const r = await fetch(url, {
        headers: { accept: "application/rdap+json, application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(4000)
      });
      if (r.status === 404) {
        res.setHeader("Cache-Control", "s-maxage=3600");
        res.status(200).json({ domain, notFound: true });
        return;
      }
      if (!r.ok) {
        lastError = "registry answered " + r.status;
        continue;
      }
      const data = await r.json();
      const reg = (data.events || []).find((e) => e.eventAction === "registration");
      // Keep in step with privacy.html, which promises answers are cached for no more than 24 hours
      res.setHeader("Cache-Control", "s-maxage=86400");
      res.status(200).json({ domain, registered: reg ? reg.eventDate : null });
      return;
    } catch (e) {
      lastError = e && e.name === "TimeoutError" ? "registry timed out" : "registry unreachable";
    }
  }

  res.status(502).json({ error: "Lookup failed", detail: lastError });
};
