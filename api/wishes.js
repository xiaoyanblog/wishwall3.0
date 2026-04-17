const ALLOWED_TYPES = new Set(["love", "wish", "feedback"]);
const ALLOWED_COLORS = new Set(["green", "yellow", "purple", "pink", "blue", "orange"]);
const ALLOWED_STATUS = new Set(["", "doing", "done"]);
const submitAttempts = new Map();

module.exports = async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return listApprovedWishes(res);
  }

  if (req.method === "POST") {
    if (!rateLimit(submitAttempts, getClientKey(req), 8, 60 * 1000)) {
      return res.status(429).json({ error: "提交太频繁了，请稍后再试" });
    }

    if (!isJsonRequest(req)) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }

    return submitWish(req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
};

async function listApprovedWishes(res) {
  try {
    const rows = await supabaseRequest(
      "/rest/v1/wishes?approved=eq.true&select=id,content,nickname,type,color,status,done_note,done_image,ai_reply,position_left,position_top,position_rotate,z_index,created_at&order=created_at.desc&limit=120"
    );

    return res.status(200).json({
      wishes: rows.map(fromDatabaseRow)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "读取留言失败" });
  }
}

async function submitWish(req, res) {
  try {
    const body = await readJson(req);
    const settings = await loadSecuritySettings();
    const ip = cleanIp(getClientKey(req));
    const content = cleanText(body.content, 200);
    const nickname = cleanText(body.nickname || "匿名", 20) || "匿名";
    const type = ALLOWED_TYPES.has(body.type) ? body.type : "love";
    const color = ALLOWED_COLORS.has(body.color) ? body.color : "green";
    const status = ALLOWED_STATUS.has(body.status) ? body.status : "";

    if (!content) {
      return res.status(400).json({ error: "写点什么吧" });
    }

    if (settings.dailyLimitEnabled) {
      const used = await countTodaySubmissions(ip).catch((error) => {
        console.error(error);
        return 0;
      });

      if (used >= settings.dailyLimitCount) {
        return res.status(429).json({ error: `今天留言次数已达上限：${settings.dailyLimitCount} 次` });
      }
    }

    if (settings.captchaEnabled) {
      const verified = await verifyCaptcha({
        token: cleanText(body.captchaToken, 1200),
        settings,
        ip
      });

      if (!verified) {
        return res.status(400).json({ error: "验证码验证失败" });
      }
    }

    const wishPayload = {
      content,
      nickname,
      type,
      color,
      status,
      approved: true
    };

    if (settings.recordIp) {
      wishPayload.ip_address = ip;
      wishPayload.ip_recorded = true;
    }

    await supabaseRequest("/rest/v1/wishes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(wishPayload)
    });

    if (settings.recordIp || settings.dailyLimitEnabled) {
      await recordSubmission(ip).catch((error) => {
        console.error(error);
      });
    }

    return res.status(201).json({ ok: true, message: "发布成功" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "提交留言失败" });
  }
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

async function loadSecuritySettings() {
  const rows = await supabaseRequest("/rest/v1/security_settings?id=eq.1&select=record_ip,daily_limit_enabled,daily_limit_count,captcha_enabled,captcha_site_key,captcha_secret,captcha_verify_url&limit=1");
  const row = rows && rows[0];

  if (!row) {
    return defaultSecuritySettings();
  }

  return {
    recordIp: Boolean(row.record_ip),
    dailyLimitEnabled: Boolean(row.daily_limit_enabled),
    dailyLimitCount: clampNumber(Number(row.daily_limit_count || 5), 1, 1000),
    captchaEnabled: Boolean(row.captcha_enabled),
    captchaSiteKey: row.captcha_site_key || "",
    captchaSecret: row.captcha_secret || "",
    captchaVerifyUrl: row.captcha_verify_url || ""
  };
}

function defaultSecuritySettings() {
  return {
    recordIp: false,
    dailyLimitEnabled: false,
    dailyLimitCount: 5,
    captchaEnabled: false,
    captchaSiteKey: "",
    captchaSecret: "",
    captchaVerifyUrl: ""
  };
}

async function countTodaySubmissions(ipAddress) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const path = `/rest/v1/wish_submission_logs?ip_address=eq.${encodeURIComponent(ipAddress)}&created_at=gte.${encodeURIComponent(today.toISOString())}&select=id&limit=1000`;
  const rows = await supabaseRequest(path);
  return Array.isArray(rows) ? rows.length : 0;
}

async function recordSubmission(ipAddress) {
  await supabaseRequest("/rest/v1/wish_submission_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ip_address: ipAddress })
  });
}

async function verifyCaptcha({ token, settings, ip }) {
  if (!token || !settings.captchaSecret || !settings.captchaVerifyUrl) {
    return false;
  }

  try {
    const params = new URLSearchParams();
    params.set("secret", settings.captchaSecret);
    params.set("response", token);
    params.set("remoteip", ip);
    if (settings.captchaSiteKey) {
      params.set("sitekey", settings.captchaSiteKey);
    }

    const response = await fetch(settings.captchaVerifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !(data.success === true || data.ok === true)) {
      console.error("Captcha verification failed", {
        status: response.status,
        errors: data["error-codes"] || data.errors || data.error || null
      });
    }
    return response.ok && (data.success === true || data.ok === true);
  } catch (error) {
    console.error(error);
    return false;
  }
}

function fromDatabaseRow(row) {
  const position = normalizePosition(row);

  return {
    id: row.id,
    content: cleanText(row.content, 200),
    nickname: cleanText(row.nickname || "匿名", 20) || "匿名",
    type: ALLOWED_TYPES.has(row.type) ? row.type : "love",
    color: ALLOWED_COLORS.has(row.color) ? row.color : "green",
    status: ALLOWED_STATUS.has(row.status) ? row.status : "",
    doneNote: cleanText(row.done_note, 300),
    doneImage: cleanUrl(row.done_image, 500),
    aiReply: cleanText(row.ai_reply, 500),
    position,
    z: normalizeNumber(row.z_index, 200),
    createdAt: row.created_at
  };
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

function normalizePosition(row) {
  if (row.position_left == null || row.position_top == null) {
    return null;
  }

  const left = Number(row.position_left);
  const top = Number(row.position_top);
  const rotate = Number(row.position_rotate || 0);

  if (![left, top, rotate].every(Number.isFinite)) {
    return null;
  }

  return { left, top, rotate };
}

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanIp(value) {
  return String(value || "")
    .replace(/[^0-9a-fA-F:.,\s-]/g, "")
    .split(",")[0]
    .trim()
    .slice(0, 64) || "unknown";
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
      if (raw.length > 4096) {
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
