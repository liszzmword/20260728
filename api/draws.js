const DEFAULT_TABLE = "lotto_draws";

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function isValidDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeNumbers(numbers) {
  if (!Array.isArray(numbers)) return null;
  const cleaned = numbers
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 45);
  return cleaned.length === 6 ? cleaned : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tableName = process.env.SUPABASE_TABLE_NAME || DEFAULT_TABLE;

  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, {
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  let body = "";
  await new Promise((resolve, reject) => {
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", resolve);
    req.on("error", reject);
  });

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    return send(res, 400, { error: "Invalid JSON body" });
  }

  const birthdate = payload.birthdate;
  const zodiacKey = payload.zodiac_key;
  const zodiacKo = payload.zodiac_ko;
  const zodiacEn = payload.zodiac_en;
  const numbers = normalizeNumbers(payload.numbers);
  const bonus = Number(payload.bonus);
  const explanation = typeof payload.explanation === "string" ? payload.explanation.trim() : "";
  const chatReply = typeof payload.chat_reply === "string" ? payload.chat_reply.trim() : "";
  const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : "gpt-5.4-mini";
  const source = typeof payload.source === "string" && payload.source.trim() ? payload.source.trim() : "openai";

  if (!isValidDate(birthdate)) {
    return send(res, 400, { error: "birthdate must be YYYY-MM-DD" });
  }

  if (!zodiacKey || !zodiacKo || !zodiacEn) {
    return send(res, 400, { error: "Missing zodiac fields" });
  }

  if (!numbers) {
    return send(res, 400, { error: "numbers must contain exactly 6 integers between 1 and 45" });
  }

  if (!Number.isInteger(bonus) || bonus < 1 || bonus > 45 || numbers.includes(bonus)) {
    return send(res, 400, { error: "bonus must be an integer between 1 and 45 and not duplicate numbers" });
  }

  const insertPayload = {
    birthdate,
    zodiac_key: zodiacKey,
    zodiac_ko: zodiacKo,
    zodiac_en: zodiacEn,
    numbers,
    bonus,
    explanation,
    chat_reply: chatReply,
    model,
    source,
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(insertPayload),
  });

  const text = await response.text();

  if (!response.ok) {
    return send(res, response.status, {
      error: "Supabase insert failed",
      details: text,
    });
  }

  let inserted;
  try {
    inserted = text ? JSON.parse(text) : [];
  } catch {
    inserted = text;
  }

  return send(res, 200, {
    ok: true,
    inserted,
  });
};
