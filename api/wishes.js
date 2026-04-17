const ALLOWED_TYPES = new Set(["love", "wish", "feedback"]);
const ALLOWED_COLORS = new Set(["green", "yellow", "purple", "pink", "blue", "orange"]);
const ALLOWED_STATUS = new Set(["", "doing", "done"]);

module.exports = async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return listApprovedWishes(res);
  }

  if (req.method === "POST") {
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
    const content = cleanText(body.content, 200);
    const nickname = cleanText(body.nickname || "匿名", 20) || "匿名";
    const type = ALLOWED_TYPES.has(body.type) ? body.type : "love";
    const color = ALLOWED_COLORS.has(body.color) ? body.color : "green";
    const status = ALLOWED_STATUS.has(body.status) ? body.status : "";

    if (!content) {
      return res.status(400).json({ error: "写点什么吧" });
    }

    await supabaseRequest("/rest/v1/wishes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        content,
        nickname,
        type,
        color,
        status,
        approved: true
      })
    });

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
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
}
