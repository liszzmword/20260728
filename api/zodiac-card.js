const DEFAULT_ENDPOINT = "https://api.segmind.com/v1/higgsfield-soul-2";

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
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

  const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const aspectRatio = typeof payload.aspect_ratio === "string" ? payload.aspect_ratio : "3:4";
  const resolution = typeof payload.resolution === "string" ? payload.resolution : "1080p";
  const endpoint = typeof process.env.SOUL2_API_URL === "string" && process.env.SOUL2_API_URL.trim()
    ? process.env.SOUL2_API_URL.trim()
    : DEFAULT_ENDPOINT;

  if (!apiKey) {
    return send(res, 400, {
      error: "Missing apiKey",
      hint: "Soul 2 API 키를 입력해 주세요. Segmind 문서는 x-api-key 인증만 안내합니다.",
    });
  }

  if (!prompt) {
    return send(res, 400, { error: "Missing prompt" });
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: aspectRatio,
      resolution,
    }),
  });

  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const errorText = await response.text();
    return send(res, response.status, {
      error: "Soul 2 image generation failed",
      upstream_status: response.status,
      details: errorText.slice(0, 500),
      endpoint,
    });
  }

  if (contentType.includes("application/json")) {
    const json = await response.json();
    const imageUrl =
      (isPlainObject(json) && (json.image_url || json.output || json.url)) ||
      (Array.isArray(json?.output) && json.output[0]?.url) ||
      null;

    if (typeof imageUrl === "string" && imageUrl) {
      return send(res, 200, { ok: true, image_data_url: imageUrl });
    }

    return send(res, 200, { ok: true, raw: json, endpoint });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const dataUrl = `data:${contentType || "image/png"};base64,${buffer.toString("base64")}`;
  return send(res, 200, { ok: true, image_data_url: dataUrl, endpoint });
};
