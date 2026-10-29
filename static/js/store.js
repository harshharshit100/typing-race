// Local persistence: settings, test history and personal records.

import { CUSTOM_TIME, isValidMode } from "./data.js";

const SETTINGS_KEY = "typingrace.settings.v1";
const HISTORY_KEY = "typingrace.history.v1";
const LEGACY_SETTINGS_KEY = "typerush.settings.v1";
const LEGACY_HISTORY_KEY = "typerush.history.v1";
const MAX_HISTORY = 200;
const VALID_THEMES = ["dark", "light", "system"];

export const DEFAULT_SETTINGS = {
  mode: "time-30",
  theme: "system",
  sound: false,
  punctuation: true,
  numbers: false,
  name: "",
  customSeconds: CUSTOM_TIME.default,
};

// Carry records over from the old TypeRush keys the first time the app runs.
function migrateLegacyKeys() {
  try {
    if (!window.localStorage.getItem(SETTINGS_KEY)) {
      const legacy = window.localStorage.getItem(LEGACY_SETTINGS_KEY);
      if (legacy) window.localStorage.setItem(SETTINGS_KEY, legacy);
    }
    if (!window.localStorage.getItem(HISTORY_KEY)) {
      const legacy = window.localStorage.getItem(LEGACY_HISTORY_KEY);
      if (legacy) window.localStorage.setItem(HISTORY_KEY, legacy);
    }
  } catch {
    // Storage can be unavailable (private mode); the app still runs.
  }
}

migrateLegacyKeys();

function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function getSettings() {
  const stored = readJSON(SETTINGS_KEY, {});
  const settings = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === "object" ? stored : {}) };

  if (!isValidMode(settings.mode)) settings.mode = DEFAULT_SETTINGS.mode;
  if (!VALID_THEMES.includes(settings.theme)) settings.theme = DEFAULT_SETTINGS.theme;
  const customSeconds = Math.round(Number(settings.customSeconds));
  settings.customSeconds = Number.isFinite(customSeconds)
    ? Math.min(CUSTOM_TIME.max, Math.max(CUSTOM_TIME.min, customSeconds))
    : DEFAULT_SETTINGS.customSeconds;
  settings.sound = Boolean(settings.sound);
  settings.punctuation = settings.punctuation !== false;
  settings.numbers = Boolean(settings.numbers);
  settings.name = String(settings.name || "").slice(0, 20);
  return settings;
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJSON(SETTINGS_KEY, next);
  return next;
}

function sanitiseResult(result) {
  const mode = isValidMode(result.mode) ? result.mode : "time-30";
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : fallback;
  };
  return {
    mode,
    wpm: number(result.wpm),
    raw: number(result.raw),
    accuracy: number(result.accuracy, 100),
    consistency: number(result.consistency),
    duration: number(result.duration),
    errors: Math.max(0, Math.round(Number(result.errors) || 0)),
    correctChars: Math.max(0, Math.round(Number(result.correctChars) || 0)),
    typedChars: Math.max(0, Math.round(Number(result.typedChars) || 0)),
    date: result.date || new Date().toISOString(),
  };
}

export function getHistory() {
  const history = readJSON(HISTORY_KEY, []);
  return Array.isArray(history) ? history.filter((item) => item && isValidMode(item.mode)) : [];
}

export function addResult(result) {
  const history = getHistory();
  history.unshift(sanitiseResult(result));
  writeJSON(HISTORY_KEY, history.slice(0, MAX_HISTORY));
}

export function getBest(mode) {
  const results = getHistory().filter((item) => item.mode === mode);
  if (!results.length) return null;
  return results.reduce((best, item) => {
    if (item.wpm > best.wpm) return item;
    if (item.wpm === best.wpm && item.accuracy > best.accuracy) return item;
    return best;
  });
}

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousDay(key) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return dayKey(date);
}

function calculateStreak(history) {
  const days = [...new Set(history.map((item) => dayKey(item.date)).filter(Boolean))].sort().reverse();
  if (!days.length) return 0;

  const today = dayKey(new Date());
  const yesterday = previousDay(today);
  if (days[0] !== today && days[0] !== yesterday) return 0;

  let streak = 0;
  let cursor = days[0];
  for (const day of days) {
    if (day !== cursor) break;
    streak += 1;
    cursor = previousDay(cursor);
  }
  return streak;
}

export function getStats() {
  const history = getHistory();
  if (!history.length) {
    return { tests: 0, averageWpm: 0, bestWpm: 0, averageAccuracy: 0, streak: 0, bestMode: null };
  }

  const recent = history.slice(0, 50);
  const average = (items, key) => items.reduce((sum, item) => sum + Number(item[key] || 0), 0) / items.length;
  const best = history.reduce((top, item) => (item.wpm > top.wpm ? item : top), history[0]);

  return {
    tests: history.length,
    averageWpm: Math.round(average(recent, "wpm")),
    bestWpm: Math.round(best.wpm),
    averageAccuracy: Math.round(average(recent, "accuracy")),
    streak: calculateStreak(history),
    bestMode: best.mode,
  };
}
