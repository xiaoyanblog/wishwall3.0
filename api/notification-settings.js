const crypto = require("crypto");
const net = require("net");
const tls = require("tls");

const authFailures = new Map();
const PROVIDERS = new Set(["smtp", "brevo"]);

module.exports = async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
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
    return getNotificationData(req, res);
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

  if (req.method === "POST") {
    if (!isTrustedOrigin(req)) {
      return res.status(403).json({ error: "Forbidden origin" });
    }

    if (!isJsonRequest(req)) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }

    return sendTestNotification(req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
};

async function getNotificationData(req, res) {
  try {
    const limit = clampNumber(Number(req.query.limit || 80), 1, 200);
    const [settings, logs] = await Promise.all([
      loadSettings(),
      supabaseRequest(`/rest/v1/notification_logs?select=id,wish_id,provider,recipient_email,subject,status,message_id,error_message,created_at&order=created_at.desc&limit=${limit}`)
    ]);

    return res.status(200).json({
      settings,
      logs: (logs || []).map(fromLogRow)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "读取通知设置失败，请确认已执行最新 database/schema.sql" });
  }
}

async function updateSettings(req, res) {
  try {
    const body = await readJson(req);
    const payload = buildSettingsPayload(body);

    await supabaseRequest("/rest/v1/notification_settings?id=eq.1", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload)
    });

    return res.status(200).json({ settings: await loadSettings() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "保存通知设置失败，请确认已执行最新 database/schema.sql" });
  }
}

async function sendTestNotification(req, res) {
  try {
    const body = await readJson(req);

    if (body.action !== "test") {
      return res.status(400).json({ error: "未知操作" });
    }

    const settings = await loadSettings();
    const subject = `${settings.subjectPrefix || "New wish"} 测试通知`;
    const text = "这是一封来自标签墙的测试邮件。收到它，说明通知配置已经可以正常发信。";
    const html = "<p>这是一封来自标签墙的测试邮件。</p><p>收到它，说明通知配置已经可以正常发信。</p>";
    const result = await sendNotificationEmail(settings, { subject, text, html });
    await recordNotificationLog({
      wishId: null,
      provider: settings.provider,
      recipientEmail: settings.recipientEmail,
      subject,
      status: result.ok ? "sent" : "failed",
      messageId: result.messageId || "",
      errorMessage: result.error || ""
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.error || "测试邮件发送失败" });
    }

    return res.status(200).json({ ok: true, messageId: result.messageId || "" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "测试邮件发送失败" });
  }
}

function buildSettingsPayload(body) {
  const provider = PROVIDERS.has(body.provider) ? body.provider : "brevo";

  return {
    enabled: Boolean(body.enabled),
    provider,
    recipient_email: cleanEmail(body.recipientEmail, 300),
    sender_email: cleanEmail(body.senderEmail, 300),
    sender_name: cleanText(body.senderName || "Wish Wall", 100) || "Wish Wall",
    subject_prefix: cleanText(body.subjectPrefix || "New wish", 120) || "New wish",
    brevo_api_key: cleanSecret(body.brevoApiKey, 1000),
    smtp_host: cleanHost(body.smtpHost, 300),
    smtp_port: clampNumber(Number(body.smtpPort || 587), 1, 65535),
    smtp_secure: Boolean(body.smtpSecure),
    smtp_user: cleanText(body.smtpUser, 300),
    smtp_pass: cleanSecret(body.smtpPass, 1000),
    updated_at: new Date().toISOString()
  };
}

async function loadSettings() {
  const rows = await supabaseRequest("/rest/v1/notification_settings?id=eq.1&select=enabled,provider,recipient_email,sender_email,sender_name,subject_prefix,brevo_api_key,smtp_host,smtp_port,smtp_secure,smtp_user,smtp_pass,updated_at&limit=1");
  const row = rows && rows[0];

  if (!row) {
    return defaultSettings();
  }

  return {
    enabled: Boolean(row.enabled),
    provider: PROVIDERS.has(row.provider) ? row.provider : "brevo",
    recipientEmail: row.recipient_email || "",
    senderEmail: row.sender_email || "",
    senderName: row.sender_name || "Wish Wall",
    subjectPrefix: row.subject_prefix || "New wish",
    brevoApiKey: row.brevo_api_key || "",
    smtpHost: row.smtp_host || "",
    smtpPort: clampNumber(Number(row.smtp_port || 587), 1, 65535),
    smtpSecure: Boolean(row.smtp_secure),
    smtpUser: row.smtp_user || "",
    smtpPass: row.smtp_pass || "",
    updatedAt: row.updated_at || ""
  };
}

function defaultSettings() {
  return {
    enabled: false,
    provider: "brevo",
    recipientEmail: "",
    senderEmail: "",
    senderName: "Wish Wall",
    subjectPrefix: "New wish",
    brevoApiKey: "",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "",
    updatedAt: ""
  };
}

async function sendNotificationEmail(settings, message) {
  if (!settings.recipientEmail || !settings.senderEmail) {
    return { ok: false, error: "请先配置发件邮箱和收件邮箱" };
  }

  if (settings.provider === "smtp") {
    return sendBySmtp(settings, message);
  }

  return sendByBrevo(settings, message);
}

async function sendByBrevo(settings, message) {
  if (!settings.brevoApiKey) {
    return { ok: false, error: "请先配置 Brevo API Key" };
  }

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "api-key": settings.brevoApiKey
      },
      body: JSON.stringify({
        sender: {
          name: settings.senderName || "Wish Wall",
          email: settings.senderEmail
        },
        to: [{ email: settings.recipientEmail }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text
      })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return { ok: false, error: data.message || `Brevo API 返回 ${response.status}` };
    }

    return { ok: true, messageId: data.messageId || data.messageIds?.[0] || "" };
  } catch (error) {
    return { ok: false, error: error.message || "Brevo API 请求失败" };
  }
}

async function sendBySmtp(settings, message) {
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
    return { ok: false, error: "请先完整配置 SMTP 主机、账号和密码" };
  }

  const client = new SmtpClient({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure
  });

  try {
    await client.connect();
    await client.ehlo();

    if (!settings.smtpSecure) {
      await client.startTls();
      await client.ehlo();
    }

    await client.authLogin(settings.smtpUser, settings.smtpPass);
    await client.mailFrom(settings.senderEmail);
    await client.rcptTo(settings.recipientEmail);
    await client.data(buildMimeMessage(settings, message));
    await client.quit();
    return { ok: true, messageId: "" };
  } catch (error) {
    client.close();
    return { ok: false, error: error.message || "SMTP 发送失败" };
  }
}

class SmtpClient {
  constructor({ host, port, secure }) {
    this.host = host;
    this.port = port;
    this.secure = secure;
    this.socket = null;
    this.buffer = "";
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const onConnect = () => {
        this.socket.setEncoding("utf8");
        this.socket.on("data", (chunk) => this.onData(chunk));
        this.socket.on("error", reject);
        this.read().then((response) => {
          this.expect(response, [220]);
          resolve();
        }).catch(reject);
      };

      this.socket = this.secure
        ? tls.connect({ host: this.host, port: this.port, servername: this.host }, onConnect)
        : net.connect({ host: this.host, port: this.port }, onConnect);

      this.socket.setTimeout(15000, () => {
        this.socket.destroy(new Error("SMTP 连接超时"));
      });
      this.socket.on("error", reject);
    });
  }

  async ehlo() {
    this.expect(await this.command(`EHLO ${getHostname()}`), [250]);
  }

  async startTls() {
    this.expect(await this.command("STARTTLS"), [220]);
    this.socket.removeAllListeners("data");
    await new Promise((resolve, reject) => {
      this.socket = tls.connect({
        socket: this.socket,
        servername: this.host
      }, resolve);
      this.socket.once("error", reject);
    });
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => this.onData(chunk));
  }

  async authLogin(user, pass) {
    this.expect(await this.command("AUTH LOGIN"), [334]);
    this.expect(await this.command(Buffer.from(user).toString("base64")), [334]);
    this.expect(await this.command(Buffer.from(pass).toString("base64")), [235]);
  }

  async mailFrom(email) {
    this.expect(await this.command(`MAIL FROM:<${email}>`), [250]);
  }

  async rcptTo(email) {
    this.expect(await this.command(`RCPT TO:<${email}>`), [250, 251]);
  }

  async data(message) {
    this.expect(await this.command("DATA"), [354]);
    this.expect(await this.command(`${message}\r\n.`), [250]);
  }

  async quit() {
    try {
      await this.command("QUIT");
    } finally {
      this.close();
    }
  }

  command(text) {
    this.socket.write(`${text}\r\n`);
    return this.read();
  }

  read() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.flush();
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    this.flush();
  }

  flush() {
    if (!this.waiters.length) {
      return;
    }

    const response = readSmtpResponse(this.buffer);
    if (!response) {
      return;
    }

    this.buffer = this.buffer.slice(response.length);
    this.waiters.shift().resolve(response.text);
  }

  expect(response, codes) {
    const code = Number(response.slice(0, 3));
    if (!codes.includes(code)) {
      throw new Error(`SMTP 返回异常：${response.replace(/\s+/g, " ").slice(0, 180)}`);
    }
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
    }
  }
}

function readSmtpResponse(buffer) {
  const lines = buffer.split(/\r?\n/);
  let length = 0;

  for (const line of lines) {
    if (!line) {
      length += 2;
      continue;
    }

    length += line.length + 2;
    if (/^\d{3} /.test(line)) {
      return { text: buffer.slice(0, length), length };
    }
  }

  return null;
}

function buildMimeMessage(settings, message) {
  const boundary = `wishwall-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const headers = [
    `From: ${formatAddress(settings.senderName, settings.senderEmail)}`,
    `To: ${settings.recipientEmail}`,
    `Subject: ${encodeMimeWord(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];

  return [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.html,
    `--${boundary}--`
  ].join("\r\n").replace(/^\./gm, "..");
}

function formatAddress(name, email) {
  return `${encodeMimeWord(name || "Wish Wall")} <${email}>`;
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

async function recordNotificationLog({ wishId, provider, recipientEmail, subject, status, messageId, errorMessage }) {
  await supabaseRequest("/rest/v1/notification_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      wish_id: wishId || null,
      provider,
      recipient_email: recipientEmail,
      subject,
      status,
      message_id: cleanText(messageId, 500),
      error_message: cleanText(errorMessage, 1000)
    })
  });
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

function fromLogRow(row) {
  return {
    id: row.id,
    wishId: row.wish_id || "",
    provider: row.provider || "",
    recipientEmail: row.recipient_email || "",
    subject: row.subject || "",
    status: row.status || "",
    messageId: row.message_id || "",
    errorMessage: row.error_message || "",
    createdAt: row.created_at || ""
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

function getHostname() {
  return "wishwall.local";
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

function cleanHost(value, maxLength) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9.-]/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanEmail(value, maxLength) {
  const text = String(value || "").trim().slice(0, maxLength);
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text) ? text : "";
}

function cleanSecret(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
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
      if (raw.length > 24 * 1024) {
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
