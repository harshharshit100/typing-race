// Canvas charts: WPM-over-time and a tiny history sparkline.

function prepare(canvas, fallbackHeight = 160) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || 560));
  const height = Math.max(1, Math.round(rect.height || fallbackHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: read("--accent", "#7c5cff"),
    accent2: read("--accent-2", "#22d3ee"),
    text: read("--text", "#eef2ff"),
    muted: read("--muted", "#94a3b8"),
    line: read("--border", "rgba(148,163,184,.18)"),
    panel: read("--panel-solid", "#111827"),
  };
}

function smoothPath(ctx, points) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midX = (previous.x + current.x) / 2;
    const midY = (previous.y + current.y) / 2;
    ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

export function drawWpmChart(canvas, samples, duration) {
  if (!canvas) return;
  const { ctx, width, height } = prepare(canvas, 170);
  const colors = themeColors();

  const points = (Array.isArray(samples) ? samples : [])
    .filter((sample) => Number.isFinite(sample?.t) && Number.isFinite(sample?.wpm))
    .map((sample) => ({ t: Math.max(0, sample.t), wpm: Math.max(0, sample.wpm) }));

  if (points.length === 0) {
    ctx.fillStyle = colors.muted;
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Not enough data for a chart", width / 2, height / 2);
    return;
  }

  const pad = { top: 14, right: 12, bottom: 28, left: 36 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = Math.max(10, height - pad.top - pad.bottom);
  const totalTime = Math.max(1, Number(duration) || points[points.length - 1].t || 1);
  const peak = Math.max(...points.map((point) => point.wpm), 10);
  const maxWpm = Math.ceil((peak * 1.18) / 10) * 10;

  const xFor = (time) => pad.left + (Math.min(time, totalTime) / totalTime) * plotW;
  const yFor = (wpm) => pad.top + plotH - (wpm / maxWpm) * plotH;

  // Horizontal grid + y labels
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let step = 0; step <= 2; step += 1) {
    const value = (maxWpm / 2) * step;
    const y = yFor(value);
    ctx.beginPath();
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.setLineDash(step === 0 ? [] : [3, 5]);
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.muted;
    ctx.fillText(String(Math.round(value)), pad.left - 8, y);
  }

  // X labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const ticks = [0, totalTime / 2, totalTime];
  ticks.forEach((value) => {
    ctx.fillStyle = colors.muted;
    ctx.fillText(`${Math.round(value)}s`, xFor(value), height - pad.bottom + 9);
  });

  const mapped = points.map((point) => ({ x: xFor(point.t), y: yFor(point.wpm) }));
  if (mapped.length === 1) {
    mapped.push({ x: xFor(totalTime), y: mapped[0].y });
  }

  // Area fill
  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  gradient.addColorStop(0, `${colors.accent}4d`);
  gradient.addColorStop(0.65, `${colors.accent2}14`);
  gradient.addColorStop(1, `${colors.accent2}00`);

  ctx.beginPath();
  smoothPath(ctx, mapped);
  ctx.lineTo(mapped[mapped.length - 1].x, pad.top + plotH);
  ctx.lineTo(mapped[0].x, pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line
  const stroke = ctx.createLinearGradient(pad.left, 0, width - pad.right, 0);
  stroke.addColorStop(0, colors.accent);
  stroke.addColorStop(1, colors.accent2);
  ctx.beginPath();
  smoothPath(ctx, mapped);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // Points on each sample
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(xFor(point.t), yFor(point.wpm), 2.2, 0, Math.PI * 2);
    ctx.fillStyle = colors.panel;
    ctx.fill();
    ctx.strokeStyle = colors.accent2;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Glow on the final point
  const last = mapped[mapped.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = `${colors.accent2}26`;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = colors.accent2;
  ctx.fill();
}

export function drawSparkline(canvas, values) {
  if (!canvas) return;
  const { ctx, width, height } = prepare(canvas, 48);
  const colors = themeColors();
  const data = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);

  if (data.length < 2) {
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    return;
  }

  const pad = 4;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const span = Math.max(1, max - min);
  const points = data.map((value, index) => ({
    x: pad + (index / (data.length - 1)) * (width - pad * 2),
    y: pad + (1 - (value - min) / span) * (height - pad * 2),
  }));

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `${colors.accent}40`);
  gradient.addColorStop(1, `${colors.accent}00`);

  ctx.beginPath();
  smoothPath(ctx, points);
  ctx.lineTo(width - pad, height);
  ctx.lineTo(pad, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  const stroke = ctx.createLinearGradient(0, 0, width, 0);
  stroke.addColorStop(0, colors.accent);
  stroke.addColorStop(1, colors.accent2);
  ctx.beginPath();
  smoothPath(ctx, points);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.stroke();
}
