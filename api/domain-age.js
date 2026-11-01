// Vercel serverless function: GET /api/domain-age?domain=example.com
// Looks up a domain's registration date through RDAP (the public successor to WHOIS).
// Always answers 200 for a valid domain so the page can tell "no record" apart from "no API here".

module.exports = async function handler(req, res) {
  const domain = String((req.query && req.query.domain) || "").trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || domain.length > 253) {
    res.status(400).json({ error: "Invalid domain" });
    return;
  }

  try {
    const r = await fetch("https://rdap.org/domain/" + encodeURIComponent(domain), {
      headers: { accept: "application/rdap+json" },
      redirect: "follow",
      signal: AbortSignal.timeout(7000)
    });
    if (r.status === 404) {
      res.setHeader("Cache-Control", "s-maxage=3600");
      res.status(200).json({ domain, notFound: true });
      return;
    }
    if (!r.ok) {
      res.status(502).json({ error: "Lookup failed" });
      return;
    }
    const data = await r.json();
    const reg = (data.events || []).find((e) => e.eventAction === "registration");
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({ domain, registered: reg ? reg.eventDate : null });
  } catch (e) {
    res.status(502).json({ error: "Lookup failed" });
  }
};
