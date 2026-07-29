const DEFAULT_ENDPOINT = "https://platform.higgsfield.ai/v1/text2image/soul";

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeQuality(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "1.5k" || raw === "2k") {
    return raw;
  }
  return "2k";
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
  const apiSecret = typeof payload.apiSecret === "string" ? payload.apiSecret.trim() : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const aspectRatio = typeof payload.aspect_ratio === "string" ? payload.aspect_ratio : "3:4";
  const resolution = typeof payload.resolution === "string" ? payload.resolution : "1080p";
  const endpoint = typeof process.env.SOUL2_API_URL === "string" && process.env.SOUL2_API_URL.trim()
    ? process.env.SOUL2_API_URL.trim()
    : DEFAULT_ENDPOINT;

  if (!apiKey) {
    return send(res, 400, {
      error: "Missing apiKey",
      hint: "Higgsfield API Key ID를 입력해 주세요.",
    });
  }

  if (!apiSecret) {
    return send(res, 400, {
      error: "Missing apiSecret",
      hint: "Higgsfield API Secret도 함께 입력해 주세요.",
    });
  }

  if (!prompt) {
    return send(res, 400, { error: "Missing prompt" });
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "higgsfield-server-js/2.0",
      Authorization: `Key ${apiKey}:${apiSecret}`,
    },
    body: JSON.stringify({
      prompt,
      width_and_height: aspectRatio === "3:4" ? "1536x2048" : "1536x1536",
      quality: normalizeQuality(resolution),
      batch_size: "single",
    }),
  });

  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const errorText = await response.text();
    const hint =
      response.status === 401
        ? "Higgsfield API Key ID와 Secret이 유효한지 다시 확인해 주세요."
        : "Higgsfield 응답을 확인해 주세요.";
    return send(res, response.status, {
      error: "Soul 2 image generation failed",
      hint,
      upstream_status: response.status,
      details: errorText.slice(0, 500),
      endpoint,
    });
  }

  let json;
  if (contentType.includes("application/json")) {
    json = await response.json();
  } else {
    const text = await response.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw_text: text };
    }
  }

  const requestId = json?.request_id;
  const statusUrl = json?.status_url;
  const directImageUrl =
    (isPlainObject(json) && (json.image_url || json.url)) ||
    (Array.isArray(json?.images) && json.images[0]?.url) ||
    null;

  if (typeof directImageUrl === "string" && directImageUrl) {
    return send(res, 200, { ok: true, image_data_url: directImageUrl, endpoint });
  }

  if (!requestId || !statusUrl) {
    return send(res, 200, { ok: true, raw: json, endpoint });
  }

  const pollHeaders = {
    Authorization: `Key ${apiKey}:${apiSecret}`,
  };

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const statusResponse = await fetch(statusUrl, {
      headers: pollHeaders,
    });
    const statusText = await statusResponse.text();
    let statusJson;
    try {
      statusJson = JSON.parse(statusText);
    } catch {
      statusJson = { raw_text: statusText };
    }

    if (!statusResponse.ok) {
      return send(res, statusResponse.status, {
        error: "Soul 2 status polling failed",
        upstream_status: statusResponse.status,
        details: statusText.slice(0, 500),
        endpoint,
        statusUrl,
      });
    }

    const status = String(statusJson?.status || "").toLowerCase();
    if (status === "completed") {
      const imageUrl =
        (Array.isArray(statusJson.images) && statusJson.images[0]?.url) ||
        statusJson?.video?.url ||
        statusJson?.url ||
        null;

      if (typeof imageUrl === "string" && imageUrl) {
        return send(res, 200, { ok: true, image_data_url: imageUrl, endpoint, requestId, statusUrl });
      }

      return send(res, 200, { ok: true, raw: statusJson, endpoint, requestId, statusUrl });
    }

    if (status === "failed" || status === "nsfw" || status === "canceled") {
      return send(res, 422, {
        error: "Soul 2 generation failed",
        details: JSON.stringify(statusJson).slice(0, 500),
        endpoint,
        requestId,
        statusUrl,
      });
    }
  }

  return send(res, 504, {
    error: "Soul 2 generation timed out",
    endpoint,
    requestId,
    statusUrl,
  });
};
