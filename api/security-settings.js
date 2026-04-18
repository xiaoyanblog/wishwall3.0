const crypto = require("crypto");

const authFailures = new Map();

module.exports = async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET" && req.query.public === "true") {
    return getPublicSettings(res);
  }

  try {
    if (!isAuthorized(req)) {
      if (!rateLimit(authFailures, getClientKey(req), 12, 5 * 60 * 1000)) {
        return res.status(429).json({ error: "尝试太频繁了，请稍后再试" });
      }

      return res.status(401).json({ error: "管理口令不正确" });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "后台未配置 ADMIN_TOKEN" });
  }

  if (req.method === "GET") {
    return getAdminSettings(res);
  }

  if (req.method === "PATCH") {
    if (!isTrustedOrigin(req)) {
      return res.status(403).json({ error: "Forbidden origin" });
    }

    if (!isJsonRequest(req)) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }

    return updateSettings(req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
};

async function getPublicSettings(res) {
  try {
    const settings = await loadSettings();

    return res.status(200).json({
      settings: {
        captchaEnabled: settings.captchaEnabled,
        adminCaptchaEnabled: settings.adminCaptchaEnabled,
        captchaSiteKey: settings.captchaSiteKey,
        captchaHelp: settings.captchaHelp,
        dailyLimitEnabled: settings.dailyLimitEnabled,
        dailyLimitCount: settings.dailyLimitCount
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(200).json({
      settings: {
        captchaEnabled: false,
        adminCaptchaEnabled: false,
        captchaSiteKey: "",
        captchaHelp: "",
        dailyLimitEnabled: false,
        dailyLimitCount: 5
      }
    });
  }
}

async function getAdminSettings(res) {
  try {
    return res.status(200).json({ settings: await loadSettings() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "读取安全设置失败，请确认已执行最新 database/schema.sql" });
  }
}

async function updateSettings(req, res) {
  try {
    const body = await readJson(req);
    const payload = {
      record_ip: Boolean(body.recordIp),
      daily_limit_enabled: Boolean(body.dailyLimitEnabled),
      daily_limit_count: clampNumber(Number(body.dailyLimitCount || 5), 1, 1000),
      captcha_enabled: Boolean(body.captchaEnabled),
      admin_captcha_enabled: Boolean(body.adminCaptchaEnabled),
      captcha_site_key: cleanText(body.captchaSiteKey, 300),
      captcha_secret: cleanText(body.captchaSecret, 500),
      captcha_verify_url: cleanUrl(body.captchaVerifyUrl, 500),
      captcha_help: cleanText(body.captchaHelp, 300),
      updated_at: new Date().toISOString()
    };

    await supabaseRequest("/rest/v1/security_settings?id=eq.1", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload)
    });

    return res.status(200).json({ settings: await loadSettings() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "保存安全设置失败，请确认已执行最新 database/schema.sql" });
  }
}

async function loadSettings() {
  const rows = await supabaseRequest("/rest/v1/security_settings?id=eq.1&select=record_ip,daily_limit_enabled,daily_limit_count,captcha_enabled,admin_captcha_enabled,captcha_site_key,captcha_secret,captcha_verify_url,captcha_help,updated_at&limit=1");
  const row = rows && rows[0];

  if (!row) {
    return defaultSettings();
  }

  return {
    recordIp: Boolean(row.record_ip),
    dailyLimitEnabled: Boolean(row.daily_limit_enabled),
    dailyLimitCount: clampNumber(Number(row.daily_limit_count || 5), 1, 1000),
    captchaEnabled: Boolean(row.captcha_enabled),
    adminCaptchaEnabled: Boolean(row.admin_captcha_enabled),
    captchaSiteKey: row.captcha_site_key || "",
    captchaSecret: row.captcha_secret || "",
    captchaVerifyUrl: row.captcha_verify_url || "",
    captchaHelp: row.captcha_help || "",
    updatedAt: row.updated_at || ""
  };
}

function defaultSettings() {
  return {
    recordIp: false,
    dailyLimitEnabled: false,
    dailyLimitCount: 5,
    captchaEnabled: false,
    adminCaptchaEnabled: false,
    captchaSiteKey: "",
    captchaSecret: "",
    captchaVerifyUrl: "",
    captchaHelp: "",
    updatedAt: ""
  };
}

async function supabaseRequest(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function isAuthorized(req) {
  const token = process.env.ADMIN_TOKEN;

  if (!token) {
    throw new Error("Missing ADMIN_TOKEN");
  }

  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const headerToken = req.headers["x-admin-token"] || "";
  return safeTokenEqual(bearer, token) || safeTokenEqual(headerToken, token);
}

function safeTokenEqual(provided, expected) {
  const providedHash = crypto.createHash("sha256").update(String(provided || "")).digest();
  const expectedHash = crypto.createHash("sha256").update(String(expected || "")).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}

function rateLimit(bucket, key, maxAttempts, windowMs) {
  const now = Date.now();
  const entry = bucket.get(key) || { count: 0, resetAt: now + windowMs };

  if (entry.resetAt <= now) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }

  entry.count += 1;
  bucket.set(key, entry);

  for (const [itemKey, item] of bucket) {
    if (item.resetAt <= now) {
      bucket.delete(itemKey);
    }
  }

  return entry.count <= maxAttempts;
}

function getClientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function isJsonRequest(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  return contentType.includes("application/json");
}

function isTrustedOrigin(req) {
  const origin = req.headers.origin;

  if (!origin) {
    return true;
  }

  try {
    const originHost = new URL(origin).host;
    const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    return originHost === requestHost;
  } catch (error) {
    return false;
  }
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanUrl(value, maxLength) {
  const text = String(value || "").trim().slice(0, maxLength);

  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    return url.protocol === "https:" ? text : "";
  } catch (error) {
    return "";
  }
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function readJson(req) {
  if (req.body && typeof req.body === "object") {
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8192) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function setJsonHeaders(res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
}
