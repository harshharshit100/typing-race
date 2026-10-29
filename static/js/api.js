// Thin fetch wrappers around the Flask API.

const DEFAULT_TIMEOUT = 10_000;

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  const external = options.signal;

  const abort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", abort, { once: true });
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = new Error((body && body.error) || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    window.clearTimeout(timer);
    if (external) external.removeEventListener("abort", abort);
  }
}

export async function fetchLeaderboard(mode, signal) {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  const data = await request(`/api/leaderboard${query}`, { signal });
  return Array.isArray(data?.scores) ? data.scores : [];
}

export async function saveScore(payload) {
  return request("/api/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchHealth(signal) {
  return request("/api/health", { signal });
}
