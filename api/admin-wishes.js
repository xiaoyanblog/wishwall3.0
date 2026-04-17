const ALLOWED_TYPES = new Set(["love", "wish", "feedback"]);
const ALLOWED_COLORS = new Set(["green", "yellow", "purple", "pink", "blue", "orange"]);
const ALLOWED_STATUS = new Set(["", "doing", "done"]);

module.exports = async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: "管理口令不正确" });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "后台未配置 ADMIN_TOKEN" });
  }

  if (req.method === "GET") {
    return listWishes(req, res);
  }

  if (req.method === "PATCH") {
    return updateWish(req, res);
  }

  if (req.method === "DELETE") {
    return deleteWish(req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
};

async function listWishes(req, res) {
  try {
    const limit = clampNumber(Number(req.query.limit || 200), 1, 500);
    const rows = await supabaseRequest(
      `/rest/v1/wishes?select=id,content,nickname,type,color,status,done_note,done_image,ai_reply,position_left,position_top,position_rotate,z_index,approved,created_at&order=created_at.desc&limit=${limit}`
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

function fromDatabaseRow(row) {
  return {
    id: row.id,
    content: row.content,
    nickname: row.nickname || "匿名",
    type: row.type || "love",
    color: row.color || "green",
    status: row.status || "",
    doneNote: row.done_note || "",
    doneImage: row.done_image || "",
    aiReply: row.ai_reply || "",
    approved: Boolean(row.approved),
    position: row.position_left == null || row.position_top == null
      ? null
      : {
          left: Number(row.position_left),
          top: Number(row.position_top),
          rotate: Number(row.position_rotate || 0)
        },
    z: row.z_index || 200,
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
  return bearer === token || headerToken === token;
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

function cleanUrl(value, maxLength) {
  const text = String(value || "").trim().slice(0, maxLength);

  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? text : "";
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
