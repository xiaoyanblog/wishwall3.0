const crypto = require("crypto");

const ALLOWED_TYPES = new Set(["love", "wish", "feedback"]);
const ALLOWED_COLORS = new Set(["green", "yellow", "purple", "pink", "blue", "orange"]);
const ALLOWED_STATUS = new Set(["", "doing", "done"]);
const authFailures = new Map();

module.exports = async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    if (req.method === "GET" && req.query.verify === "true") {
      const settings = await loadSecuritySettings();

      if (settings.adminCaptchaEnabled) {
        const verified = await verifyCaptcha({
          token: cleanCaptchaToken(req.headers["x-admin-captcha-token"] || req.query.captchaToken),
          settings,
          ip: cleanIp(getClientKey(req))
        });

        if (!verified) {
          return res.status(400).json({ error: "验证码验证失败" });
        }
      }
    }

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
    if (req.query.verify === "true") {
      return res.status(200).json({ ok: true });
    }

    return listWishes(req, res);
  }

  if (req.method === "PATCH") {
    if (!isTrustedOrigin(req)) {
      return res.status(403).json({ error: "Forbidden origin" });
    }

    if (!isJsonRequest(req)) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }

    return updateWish(req, res);
  }

  if (req.method === "DELETE") {
    if (!isTrustedOrigin(req)) {
      return res.status(403).json({ error: "Forbidden origin" });
    }

    return deleteWish(req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
};

async function listWishes(req, res) {
  try {
    const limit = clampNumber(Number(req.query.limit || 200), 1, 500);
    const rows = await supabaseRequest(
      `/rest/v1/wishes?select=id,content,nickname,type,color,status,done_note,done_image,ai_reply,position_left,position_top,position_rotate,z_index,approved,ip_address,ip_recorded,created_at&order=created_at.desc&limit=${limit}`
    );

    return res.status(200).json({
      wishes: rows.map(fromDatabaseRow)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "读取后台数据失败" });
  }
}

async function updateWish(req, res) {
  try {
    const body = await readJson(req);
    const id = cleanId(body.id);

    if (!id) {
      return res.status(400).json({ error: "缺少留言 ID" });
    }

    const payload = buildUpdatePayload(body);

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "没有可更新的字段" });
    }

    const rows = await supabaseRequest(`/rest/v1/wishes?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: "留言不存在" });
    }

    return res.status(200).json({ wish: fromDatabaseRow(rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "更新留言失败" });
  }
}

async function deleteWish(req, res) {
  try {
    const id = cleanId(req.query.id || (await readJson(req)).id);

    if (!id) {
      return res.status(400).json({ error: "缺少留言 ID" });
    }

    await supabaseRequest(`/rest/v1/wishes?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "删除留言失败" });
  }
}

function buildUpdatePayload(body) {
  const payload = {};

  if (typeof body.approved === "boolean") {
    payload.approved = body.approved;
  }

  if (typeof body.content !== "undefined") {
    payload.content = cleanText(body.content, 200);
  }

  if (typeof body.nickname !== "undefined") {
    payload.nickname = cleanText(body.nickname || "匿名", 20) || "匿名";
  }

  if (ALLOWED_TYPES.has(body.type)) {
    payload.type = body.type;
  }

  if (ALLOWED_COLORS.has(body.color)) {
    payload.color = body.color;
  }

  if (ALLOWED_STATUS.has(body.status)) {
    payload.status = body.status;
  }

  if (typeof body.doneNote !== "undefined") {
    payload.done_note = cleanText(body.doneNote, 300);
  }

  if (typeof body.doneImage !== "undefined") {
    payload.done_image = cleanUrl(body.doneImage, 500);
  }

  if (typeof body.aiReply !== "undefined") {
    payload.ai_reply = cleanText(body.aiReply, 500);
  }

  return payload;
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
  const rows = await supabaseRequest("/rest/v1/security_settings?id=eq.1&select=admin_captcha_enabled,captcha_site_key,captcha_secret,captcha_verify_url&limit=1");
  const row = rows && rows[0];

  if (!row) {
    return defaultSecuritySettings();
  }

  return {
    adminCaptchaEnabled: Boolean(row.admin_captcha_enabled),
    captchaSiteKey: row.captcha_site_key || "",
    captchaSecret: row.captcha_secret || "",
    captchaVerifyUrl: row.captcha_verify_url || ""
  };
}

function defaultSecuritySettings() {
  return {
    adminCaptchaEnabled: false,
    captchaSiteKey: "",
    captchaSecret: "",
    captchaVerifyUrl: ""
  };
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
      console.error("Admin captcha verification failed", {
        status: response.status,
        errors: data["error-codes"] || data.errors || data.error || null,
        tokenLength: token.length
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
    approved: Boolean(row.approved),
    ipAddress: row.ip_recorded ? cleanIp(row.ip_address) : "",
    ipRecorded: Boolean(row.ip_recorded),
    position,
    z: normalizeNumber(row.z_index, 200),
    createdAt: row.created_at
  };
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

function cleanId(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f-]{32,36}$/i.test(text) ? text : "";
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanCaptchaToken(value) {
  return String(value || "").trim().slice(0, 10000);
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
    return max;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
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
    .slice(0, 64);
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
