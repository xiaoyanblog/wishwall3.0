const net = require("net");
const tls = require("tls");

const ALLOWED_TYPES = new Set(["love", "wish", "feedback"]);
const ALLOWED_COLORS = new Set(["green", "yellow", "purple", "pink", "blue", "orange"]);
const ALLOWED_STATUS = new Set(["", "doing", "done"]);
const NOTIFICATION_PROVIDERS = new Set(["smtp", "brevo"]);
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
    const doneImage = cleanUrl(body.doneImage, 500);

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
        token: cleanCaptchaToken(body.captchaToken),
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
      done_image: doneImage,
      approved: true
    };

    if (settings.recordIp) {
      wishPayload.ip_address = ip;
      wishPayload.ip_recorded = true;
    }

    const createdRows = await supabaseRequest("/rest/v1/wishes", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(wishPayload)
    });
    const createdWish = createdRows && createdRows[0];

    if (settings.recordIp || settings.dailyLimitEnabled) {
      await recordSubmission(ip).catch((error) => {
        console.error(error);
      });
    }

    if (createdWish) {
      await notifyNewWish(createdWish).catch((error) => {
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

async function notifyNewWish(wishRow) {
  let notificationSettings;

  try {
    notificationSettings = await loadNotificationSettings();
  } catch (error) {
    console.error(error);
    return;
  }

  if (!notificationSettings.enabled) {
    return;
  }

  const wish = fromDatabaseRow(wishRow);
  const subject = `${notificationSettings.subjectPrefix || "New wish"} - ${typeLabel(wish.type)}`;
  const text = [
    "标签墙收到一条新留言。",
    "",
    `昵称：${wish.nickname || "匿名"}`,
    `分类：${typeLabel(wish.type)}`,
    `内容：${wish.content}`,
    `时间：${formatDate(wish.createdAt)}`
  ].join("\n");
  const html = [
    "<p>标签墙收到一条新留言。</p>",
    "<ul>",
    `<li><strong>昵称：</strong>${escapeHtml(wish.nickname || "匿名")}</li>`,
    `<li><strong>分类：</strong>${escapeHtml(typeLabel(wish.type))}</li>`,
    `<li><strong>内容：</strong>${escapeHtml(wish.content)}</li>`,
    `<li><strong>时间：</strong>${escapeHtml(formatDate(wish.createdAt))}</li>`,
    "</ul>"
  ].join("");
  const result = await sendNotificationEmail(notificationSettings, { subject, text, html });

  await recordNotificationLog({
    wishId: wish.id,
    provider: notificationSettings.provider,
    recipientEmail: notificationSettings.recipientEmail,
    subject,
    status: result.ok ? "sent" : "failed",
    messageId: result.messageId || "",
    errorMessage: result.error || ""
  }).catch((error) => {
    console.error(error);
  });
}

async function loadNotificationSettings() {
  const rows = await supabaseRequest("/rest/v1/notification_settings?id=eq.1&select=enabled,provider,recipient_email,sender_email,sender_name,subject_prefix,brevo_api_key,smtp_host,smtp_port,smtp_secure,smtp_user,smtp_pass&limit=1");
  const row = rows && rows[0];

  if (!row) {
    return defaultNotificationSettings();
  }

  return {
    enabled: Boolean(row.enabled),
    provider: NOTIFICATION_PROVIDERS.has(row.provider) ? row.provider : "brevo",
    recipientEmail: row.recipient_email || "",
    senderEmail: row.sender_email || "",
    senderName: row.sender_name || "Wish Wall",
    subjectPrefix: row.subject_prefix || "New wish",
    brevoApiKey: row.brevo_api_key || "",
    smtpHost: row.smtp_host || "",
    smtpPort: clampNumber(Number(row.smtp_port || 587), 1, 65535),
    smtpSecure: Boolean(row.smtp_secure),
    smtpUser: row.smtp_user || "",
    smtpPass: row.smtp_pass || ""
  };
}

function defaultNotificationSettings() {
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
    smtpPass: ""
  };
}

async function sendNotificationEmail(settings, message) {
  if (!settings.recipientEmail || !settings.senderEmail) {
    return { ok: false, error: "通知邮箱配置不完整" };
  }

  if (settings.provider === "smtp") {
    return sendBySmtp(settings, message);
  }

  return sendByBrevo(settings, message);
}

async function sendByBrevo(settings, message) {
  if (!settings.brevoApiKey) {
    return { ok: false, error: "Brevo API Key 未配置" };
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
    return { ok: false, error: "SMTP 配置不完整" };
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
    this.expect(await this.command("EHLO wishwall.local"), [250]);
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
    return new Promise((resolve) => {
      this.waiters.push({ resolve });
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
    `From: ${encodeMimeWord(settings.senderName || "Wish Wall")} <${settings.senderEmail}>`,
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

function cleanCaptchaToken(value) {
  return String(value || "").trim().slice(0, 10000);
}

function typeLabel(slug) {
  if (slug === "wish") {
    return "心愿";
  }
  if (slug === "feedback") {
    return "反馈";
  }
  return "Love";
}

function formatDate(dateText) {
  const date = new Date(dateText);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
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
      if (raw.length > 16 * 1024) {
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
