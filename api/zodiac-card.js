const DEFAULT_ENDPOINT = "https://platform.higgsfield.ai/v1/text2image/soul";

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

// Higgsfield only accepts "720p" | "1080p"; map legacy "1.5k"/"2k" values to "1080p".
function normalizeQuality(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "720p") {
    return "720p";
  }
  return "1080p";
}

function extractImageUrl(job) {
  const results = job && job.results;
  if (!results) return null;
  const raw = results.raw && results.raw.url;
  const min = results.min && results.min.url;
  return raw || min || null;
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

  const authHeader = `Key ${apiKey}:${apiSecret}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "higgsfield-server-js/2.0",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      params: {
        prompt,
        width_and_height: aspectRatio === "3:4" ? "1536x2048" : "1536x1536",
        quality: normalizeQuality(resolution),
        batch_size: 1,
      },
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    const hint =
      response.status === 401
        ? "Higgsfield API Key ID와 Secret이 유효한지 다시 확인해 주세요."
        : "Higgsfield 응답을 확인해 주세요.";
    return send(res, response.status, {
      error: "Soul 2 image generation failed",
      hint,
      upstream_status: response.status,
      details: responseText.slice(0, 500),
      endpoint,
    });
  }

  let json;
  try {
    json = JSON.parse(responseText);
  } catch {
    json = { raw_text: responseText };
  }

  const jobSetId = json && json.id;
  const firstJob = Array.isArray(json && json.jobs) ? json.jobs[0] : null;

  const immediateUrl = extractImageUrl(firstJob);
  if (typeof immediateUrl === "string" && immediateUrl) {
    return send(res, 200, { ok: true, image_data_url: immediateUrl, endpoint, jobSetId });
  }

  if (!jobSetId) {
    return send(res, 502, {
      error: "Unexpected Soul 2 response",
      details: JSON.stringify(json).slice(0, 500),
      endpoint,
    });
  }

  const statusUrl = `${new URL(endpoint).origin}/v1/job-sets/${jobSetId}`;

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const statusResponse = await fetch(statusUrl, {
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
      },
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

    const job = Array.isArray(statusJson && statusJson.jobs) ? statusJson.jobs[0] : null;
    const status = String((job && job.status) || "").toLowerCase();

    if (status === "completed") {
      const imageUrl = extractImageUrl(job);

      if (typeof imageUrl === "string" && imageUrl) {
        return send(res, 200, { ok: true, image_data_url: imageUrl, endpoint, jobSetId, statusUrl });
      }

      return send(res, 502, {
        error: "Soul 2 completed without an image URL",
        details: JSON.stringify(statusJson).slice(0, 500),
        endpoint,
        jobSetId,
        statusUrl,
      });
    }

    if (status === "failed" || status === "nsfw" || status === "canceled") {
      return send(res, 422, {
        error: "Soul 2 generation failed",
        details: JSON.stringify(statusJson).slice(0, 500),
        endpoint,
        jobSetId,
        statusUrl,
      });
    }
  }

  return send(res, 504, {
    error: "Soul 2 generation timed out",
    endpoint,
    jobSetId,
    statusUrl,
  });
};
