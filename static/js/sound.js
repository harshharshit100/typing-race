// Tiny WebAudio sound engine — no assets required.

let enabled = false;
let context = null;

function ensureContext() {
  if (context) {
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
  }
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) return null;
  try {
    context = new AudioEngine();
  } catch {
    context = null;
  }
  return context;
}

function tone({ frequency, duration = 0.05, type = "sine", volume = 0.03, delay = 0, slide = 0 }) {
  const ctx = ensureContext();
  if (!ctx) return;

  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + slide), start + duration);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function setSoundEnabled(value) {
  enabled = Boolean(value);
  if (enabled) ensureContext();
}

export function isSoundEnabled() {
  return enabled;
}

export function playKey() {
  if (!enabled) return;
  tone({
    frequency: 900 + Math.random() * 420,
    duration: 0.025,
    type: "triangle",
    volume: 0.014,
  });
}

export function playError() {
  if (!enabled) return;
  tone({ frequency: 190, duration: 0.09, type: "sawtooth", volume: 0.022, slide: -70 });
}

export function playFinish() {
  if (!enabled) return;
  tone({ frequency: 523.25, duration: 0.14, type: "sine", volume: 0.05 });
  tone({ frequency: 659.25, duration: 0.14, type: "sine", volume: 0.045, delay: 0.09 });
  tone({ frequency: 783.99, duration: 0.2, type: "sine", volume: 0.04, delay: 0.18 });
}
