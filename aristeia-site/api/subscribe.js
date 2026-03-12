const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const rateLimitStore = new Map();

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return String(xff[0]).split(",")[0].trim();
  }
  return "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const existing = rateLimitStore.get(ip);

  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  existing.count += 1;
  if (existing.count > RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  return false;
}

function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now - data.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(ip);
    }
  }
}

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

async function saveToSupabase(email, metadata) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tableName = process.env.SUPABASE_TABLE || "waitlist";

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(tableName)}`;
  const payload = {
    email,
    source: "aristeia-site",
    ip: metadata.ip,
    user_agent: metadata.userAgent,
    created_at: new Date().toISOString()
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Prefer: "resolution=ignore-duplicates,return=minimal"
    },
    body: JSON.stringify(payload)
  });

  if (response.ok || response.status === 409) {
    return;
  }

  const errorBody = await response.text().catch(() => "");
  throw new Error(`Supabase error (${response.status}): ${errorBody.slice(0, 200)}`);
}

module.exports = async function handler(req, res) {
  cleanupRateLimitStore();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: "Too many requests. Please try again shortly." });
  }

  const body = parseRequestBody(req);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const honeypot = typeof body.company === "string" ? body.company.trim() : "";
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;

  // Silent success for bots that fill hidden fields.
  if (honeypot) {
    return res.status(200).json({ ok: true });
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ ok: false, error: "Invalid email address." });
  }

  try {
    await saveToSupabase(email, { ip, userAgent });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Subscribe failed:", error);
    return res.status(500).json({ ok: false, error: "Subscription failed. Please try again." });
  }
};
