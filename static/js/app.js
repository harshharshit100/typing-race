// Typing Race — main application controller.

import { CUSTOM_TIME, MODE_ORDER, buildText, customModeFor, getMode, isCustomMode, isValidMode } from "./data.js";
import { getSettings, saveSettings, addResult, getBest, getStats, getHistory } from "./store.js";
import { fetchLeaderboard, saveScore } from "./api.js";
import { setSoundEnabled, playKey, playError, playFinish } from "./sound.js";
import { drawWpmChart, drawSparkline } from "./chart.js";

const $ = (id) => document.getElementById(id);

const el = {
  testCard: $("testCard"),
  stage: $("stage"),
  stageHint: $("stageHint"),
  words: $("words"),
  caret: $("caret"),
  input: $("input"),
  timer: $("timer"),
  timerUnit: $("timerUnit"),
  wpm: $("wpm"),
  accuracy: $("accuracy"),
  progressBar: $("progressBar"),
  modeButtons: [...document.querySelectorAll(".mode-switch [data-mode]")],
  customModeBtn: $("customModeBtn"),
  customForm: $("customTimeForm"),
  customInput: $("customSeconds"),
  cancelCustom: $("cancelCustomTime"),
  punctuation: $("punctuationToggle"),
  numbers: $("numbersToggle"),
  restart: $("restart"),
  themeToggle: $("themeToggle"),
  themeLabel: $("themeLabel"),
  soundToggle: $("soundToggle"),
  connectionState: $("connectionState"),
  connectionText: $("connectionText"),
  bestGrid: $("bestGrid"),
  testsCount: $("testsCount"),
  avgWpm: $("avgWpm"),
  bestEver: $("bestEver"),
  streak: $("streak"),
  historyChart: $("historyChart"),
  boardFilter: $("boardFilter"),
  boardList: $("leaderboard"),
  boardSubtitle: $("boardSubtitle"),
  overlay: $("resultOverlay"),
  resultCard: $("resultCard"),
  closeResult: $("closeResult"),
  resultModeLabel: $("resultModeLabel"),
  resultWpm: $("resultWpm"),
  resultAcc: $("resultAcc"),
  resultRaw: $("resultRaw"),
  resultConsistency: $("resultConsistency"),
  resultChars: $("resultChars"),
  resultTime: $("resultTime"),
  resultErrors: $("resultErrors"),
  pbBadge: $("pbBadge"),
  wpmChart: $("wpmChart"),
  chartPeak: $("chartPeak"),
  saveForm: $("saveForm"),
  playerName: $("playerName"),
  saveBtn: $("saveBtn"),
  shareBtn: $("shareBtn"),
  saveMsg: $("saveMsg"),
  retryBtn: $("retryBtn"),
  nextBtn: $("nextBtn"),
  toast: $("toast"),
};

const settings = getSettings();
const themeQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
const resolveTheme = (preference) =>
  preference === "light" || preference === "dark" ? preference : themeQuery?.matches ? "light" : "dark";
const customMode = () => customModeFor(customSeconds);

let mode = settings.mode;
let customSeconds = settings.customSeconds;
let themePreference = settings.theme;
let theme = resolveTheme(themePreference);
let sound = settings.sound;
let punctuation = settings.punctuation;
let numbers = settings.numbers;

const pageRegions = [document.querySelector(".site-header"), document.querySelector("main"), document.querySelector(".site-footer")].filter(
  Boolean,
);

const state = {
  text: "",
  spans: [],
  prevLen: 0,
  keystrokes: 0,
  errors: 0,
  startTime: 0,
  elapsed: 0,
  running: false,
  finished: false,
  rafId: 0,
  nextSampleAt: 1,
  lastSampleKeystrokes: 0,
  lastLiveUpdate: 0,
  samples: [],
  result: null,
  boardMode: settings.mode,
  boardRequest: null,
  savedId: null,
  toastTimer: 0,
  resizeFrame: 0,
};

// ---- Small helpers ---------------------------------------------------
const round1 = (value) => Math.round(Number(value) * 10) / 10;
const isOverlayOpen = () => !el.overlay.classList.contains("hidden");
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setConnection(status) {
  const labels = { online: "live board", offline: "offline", checking: "connecting" };
  el.connectionState.dataset.state = status;
  el.connectionText.textContent = labels[status] || status;
  el.connectionState.title =
    status === "online" ? "Connected to the score server" : status === "offline" ? "Score server unreachable" : "Checking the score server";
}

function showToast(message, kind = "info") {
  window.clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.className = `toast is-visible toast-${kind}`;
  state.toastTimer = window.setTimeout(() => {
    el.toast.classList.remove("is-visible");
  }, 3200);
}

function animateNumber(element, to, duration = 700, decimals = 0) {
  window.cancelAnimationFrame(element._counterFrame || 0);
  if (reduceMotion()) {
    element.textContent = Number(to).toFixed(decimals);
    element.dataset.value = String(to);
    return;
  }

  const from = Number(element.dataset.value || 0);
  const started = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = from + (to - from) * eased;
    element.textContent = value.toFixed(decimals);
    if (progress < 1) {
      element._counterFrame = window.requestAnimationFrame(step);
    } else {
      element.dataset.value = String(to);
      element.textContent = Number(to).toFixed(decimals);
    }
  };
  element._counterFrame = window.requestAnimationFrame(step);
}

// ---- Typing surface --------------------------------------------------
function renderText() {
  const fragment = document.createDocumentFragment();
  const spans = [];
  let currentWord = null;

  for (let index = 0; index < state.text.length; index += 1) {
    const character = state.text[index];

    if (character === " ") {
      const gap = document.createElement("span");
      gap.className = "char space";
      gap.textContent = " ";
      fragment.appendChild(gap);
      spans.push(gap);
      currentWord = null;
      continue;
    }

    if (!currentWord) {
      currentWord = document.createElement("span");
      currentWord.className = "word";
      fragment.appendChild(currentWord);
    }

    const span = document.createElement("span");
    span.className = "char";
    span.textContent = character;
    currentWord.appendChild(span);
    spans.push(span);
  }

  el.words.replaceChildren(fragment);
  el.words.scrollTop = 0;
  state.spans = spans;
}

function positionCaret(index) {
  const span = state.spans[index];
  if (!span) {
    el.caret.classList.add("is-hidden");
    return;
  }

  const targetScroll = Math.max(0, span.offsetTop - el.words.clientHeight / 2 + span.offsetHeight / 2);
  if (Math.abs(el.words.scrollTop - targetScroll) > 2) {
    el.words.scrollTop = targetScroll;
  }

  const spanRect = span.getBoundingClientRect();
  const stageRect = el.stage.getBoundingClientRect();
  const x = spanRect.left - (stageRect.left + el.stage.clientLeft);
  const y = spanRect.top - (stageRect.top + el.stage.clientTop);

  el.caret.style.transform = `translate(${x}px, ${y}px)`;
  el.caret.style.height = `${spanRect.height}px`;
  el.caret.classList.remove("is-hidden");
}

function updateView() {
  const typed = el.input.value;
  const limit = Math.min(Math.max(typed.length, state.prevLen) + 1, state.spans.length);

  for (let index = 0; index < limit; index += 1) {
    const span = state.spans[index];
    const base = state.text[index] === " " ? "char space" : "char";
    if (index < typed.length) {
      span.className = `${base} ${typed[index] === state.text[index] ? "correct" : "wrong"}`;
    } else if (index === typed.length) {
      span.className = `${base} current`;
    } else {
      span.className = base;
    }
  }

  state.prevLen = typed.length;
  positionCaret(typed.length);
}

function countCorrect(typed) {
  let correct = 0;
  const limit = Math.min(typed.length, state.text.length);
  for (let index = 0; index < limit; index += 1) {
    if (typed[index] === state.text[index]) correct += 1;
  }
  return correct;
}

function liveStats(elapsed) {
  const typed = el.input.value;
  const correct = countCorrect(typed);
  const minutes = Math.max(elapsed, 0.001) / 60;
  const showSpeed = elapsed >= 0.5;
  const accuracy = state.keystrokes
    ? Math.max(0, Math.round(((state.keystrokes - state.errors) / state.keystrokes) * 100))
    : 100;

  return {
    correct,
    typed: typed.length,
    wpm: showSpeed ? Math.max(0, Math.round(correct / 5 / minutes)) : 0,
    raw: showSpeed ? Math.max(0, Math.round(state.keystrokes / 5 / minutes)) : 0,
    accuracy,
  };
}

function updateLiveStats() {
  const elapsed = state.running ? (performance.now() - state.startTime) / 1000 : state.elapsed;
  const stats = liveStats(elapsed);
  el.wpm.textContent = String(stats.wpm);
  el.accuracy.textContent = String(stats.accuracy);
}

function setCaretEnd() {
  const end = el.input.value.length;
  try {
    el.input.setSelectionRange(end, end);
  } catch {
    // Some mobile browsers do not expose selection on hidden textareas.
  }
}

// ---- Clock -----------------------------------------------------------
function startClock() {
  state.running = true;
  state.startTime = performance.now();
  state.elapsed = 0;
  state.nextSampleAt = 1;
  state.lastSampleKeystrokes = 0;
  state.lastLiveUpdate = 0;
  state.samples = [];
  el.stage.classList.add("is-running");
  state.rafId = window.requestAnimationFrame(frame);
}

function frame(now) {
  if (!state.running) return;

  const meta = getMode(mode);
  const elapsed = Math.max(0, (now - state.startTime) / 1000);
  state.elapsed = elapsed;

  if (meta.kind === "time") {
    const remaining = Math.max(0, meta.duration - elapsed);
    el.timer.textContent = remaining < 10 ? remaining.toFixed(1) : String(Math.ceil(remaining));
    el.progressBar.style.width = `${Math.min(100, (elapsed / meta.duration) * 100)}%`;
  } else {
    el.timer.textContent = elapsed.toFixed(1);
    el.progressBar.style.width = `${Math.min(100, (el.input.value.length / state.text.length) * 100)}%`;
  }

  let guard = 0;
  while (elapsed >= state.nextSampleAt && guard < 5) {
    const chars = state.keystrokes - state.lastSampleKeystrokes;
    state.samples.push({ t: round1(state.nextSampleAt), wpm: Math.max(0, Math.round((chars / 5) * 60)) });
    state.lastSampleKeystrokes = state.keystrokes;
    state.nextSampleAt += 1;
    guard += 1;
  }
  if (elapsed - state.nextSampleAt > 5) {
    state.nextSampleAt = Math.floor(elapsed) + 1;
    state.lastSampleKeystrokes = state.keystrokes;
  }

  if (now - state.lastLiveUpdate > 180) {
    updateLiveStats();
    state.lastLiveUpdate = now;
  }

  if (meta.kind === "time" && elapsed >= meta.duration) {
    finishTest(meta.duration);
    return;
  }

  state.rafId = window.requestAnimationFrame(frame);
}

function finaliseSamples(elapsed) {
  const lastTime = state.samples.length ? state.samples[state.samples.length - 1].t : 0;
  if (elapsed - lastTime >= 0.5) {
    const chars = state.keystrokes - state.lastSampleKeystrokes;
    const span = Math.max(0.5, elapsed - lastTime);
    state.samples.push({ t: round1(elapsed), wpm: Math.max(0, Math.round((chars / 5) * (60 / span))) });
    state.lastSampleKeystrokes = state.keystrokes;
  }
}

function consistencyOf(samples) {
  const values = samples.map((sample) => Number(sample.wpm)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return 100;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.max(0, Math.min(100, 100 - (Math.sqrt(variance) / mean) * 100));
}

function finishTest(forcedElapsed = null) {
  if (state.finished) return;
  state.finished = true;
  state.running = false;
  window.cancelAnimationFrame(state.rafId);
  el.stage.classList.remove("is-running");

  let elapsed = forcedElapsed ?? (performance.now() - state.startTime) / 1000;
  if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
  state.elapsed = elapsed;

  finaliseSamples(elapsed);
  const typed = el.input.value;
  const correctChars = countCorrect(typed);
  const minutes = Math.max(elapsed, 0.1) / 60;
  const wpm = round1(correctChars / 5 / minutes);
  const raw = round1(state.keystrokes / 5 / minutes);
  const accuracy = state.keystrokes ? round1(((state.keystrokes - state.errors) / state.keystrokes) * 100) : 100;
  const consistency = round1(consistencyOf(state.samples));
  const peak = Math.max(wpm, ...state.samples.map((sample) => sample.wpm), 0);

  const result = {
    mode,
    wpm,
    raw,
    accuracy,
    consistency,
    duration: round1(elapsed),
    errors: state.errors,
    correctChars,
    typedChars: typed.length,
    samples: state.samples.slice(),
    peak,
    date: new Date().toISOString(),
  };

  const previous = getBest(mode);
  const isPersonalBest =
    !previous || wpm > previous.wpm || (wpm === previous.wpm && accuracy > previous.accuracy);

  el.input.readOnly = true;
  el.input.blur();
  el.timer.textContent = getMode(mode).kind === "time" ? "0.0" : elapsed.toFixed(1);
  el.wpm.textContent = String(Math.round(wpm));
  el.accuracy.textContent = String(Math.round(accuracy));
  el.progressBar.style.width = "100%";

  addResult(result);
  state.result = result;
  state.savedId = null;

  renderResult(result, { isPersonalBest, previous });
  renderRecords();
  playFinish();
}

// ---- New test --------------------------------------------------------
function startNewTest({ focus = true } = {}) {
  window.cancelAnimationFrame(state.rafId);

  state.text = buildText(mode, { punctuation, numbers });
  state.prevLen = 0;
  state.keystrokes = 0;
  state.errors = 0;
  state.startTime = 0;
  state.elapsed = 0;
  state.running = false;
  state.finished = false;
  state.samples = [];
  state.result = null;
  state.nextSampleAt = 1;
  state.lastSampleKeystrokes = 0;
  state.lastLiveUpdate = 0;

  el.input.value = "";
  el.input.readOnly = false;
  el.input.disabled = false;
  el.words.scrollTop = 0;
  el.stage.classList.remove("is-running");
  el.stageHint.textContent = "click here or start typing";

  const meta = getMode(mode);
  el.timer.textContent = meta.kind === "time" ? String(meta.duration) : "0.0";
  el.timerUnit.textContent = "s";
  el.wpm.textContent = "0";
  el.accuracy.textContent = "100";
  el.progressBar.style.width = "0%";

  el.saveBtn.disabled = false;
  el.saveBtn.textContent = "Save to leaderboard";
  el.saveMsg.textContent = "";
  el.pbBadge.classList.add("hidden");
  hideResult();

  renderText();
  updateView();

  if (focus) {
    window.requestAnimationFrame(() => {
      el.input.focus({ preventScroll: true });
      setCaretEnd();
    });
  }
}

// ---- Results ---------------------------------------------------------
function renderResult(result, { isPersonalBest, previous }) {
  const meta = getMode(result.mode);
  el.resultModeLabel.textContent = meta.name;
  el.resultWpm.dataset.value = "0";
  animateNumber(el.resultWpm, Math.round(result.wpm), 780, 0);
  el.resultAcc.textContent = String(round1(result.accuracy));
  el.resultRaw.textContent = String(Math.round(result.raw));
  el.resultConsistency.textContent = `${Math.round(result.consistency)}%`;
  el.resultChars.textContent = `${result.correctChars}/${result.typedChars}`;
  el.resultTime.textContent = `${result.duration.toFixed(1)}s`;
  el.resultErrors.textContent = String(result.errors);
  el.chartPeak.textContent = `peak ${Math.round(result.peak)} wpm`;

  if (isPersonalBest) {
    el.pbBadge.textContent = previous ? "★ new personal best" : "★ first run recorded";
    el.pbBadge.classList.remove("hidden");
    el.pbBadge.title = previous
      ? `Previous best: ${Math.round(previous.wpm)} wpm at ${Math.round(previous.accuracy)}% accuracy`
      : "Your first completed run in this mode";
  } else {
    el.pbBadge.classList.add("hidden");
  }

  const nextIndex = (MODE_ORDER.indexOf(result.mode) + 1) % MODE_ORDER.length;
  el.nextBtn.textContent = `next: ${getMode(MODE_ORDER[nextIndex]).label}`;
  el.saveBtn.disabled = false;
  el.saveBtn.textContent = "Save to leaderboard";
  el.saveMsg.textContent = "";
  el.playerName.value = getSettings().name;

  openResult();
}

function openResult() {
  el.overlay.classList.remove("hidden");
  el.overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
  pageRegions.forEach((region) => {
    region.inert = true;
  });
  el.resultCard.focus({ preventScroll: true });

  window.requestAnimationFrame(() => {
    if (state.result) drawWpmChart(el.wpmChart, state.result.samples, state.result.duration);
  });
}

function hideResult() {
  el.overlay.classList.add("hidden");
  el.overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
  pageRegions.forEach((region) => {
    region.inert = false;
  });
}

function restartTest({ focus = true } = {}) {
  hideResult();
  startNewTest({ focus });
}

function nextTest() {
  const index = MODE_ORDER.indexOf(mode);
  const nextMode = MODE_ORDER[(index + 1) % MODE_ORDER.length];
  hideResult();
  switchMode(nextMode, { focus: true, silent: true });
  showToast(`${getMode(nextMode).name} — go!`, "info");
}

// ---- Modes & settings ------------------------------------------------
function applyModeUI() {
  const isQuote = mode === "quote";
  const customActive = isCustomMode(mode);
  el.modeButtons.forEach((button) => {
    const active = button.dataset.mode === "custom" ? customActive : button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (customActive) {
    el.customModeBtn.textContent = getMode(mode).label;
    el.customModeBtn.title = `Custom ${getMode(mode).duration}s test — click to change`;
  } else {
    el.customModeBtn.textContent = "custom";
    el.customModeBtn.title = "Choose a custom test length";
  }

  el.punctuation.disabled = isQuote;
  el.numbers.disabled = isQuote;
  el.punctuation.closest(".toggle")?.classList.toggle("is-disabled", isQuote);
  el.numbers.closest(".toggle")?.classList.toggle("is-disabled", isQuote);
}

function switchMode(nextMode, { focus = true, silent = false } = {}) {
  if (!isValidMode(nextMode)) return;
  const hadProgress = state.running && el.input.value.length > 0;
  mode = nextMode;
  saveSettings({ mode });
  applyModeUI();
  hideCustomForm();
  startNewTest({ focus });
  renderRecords();
  loadBoard(mode);
  if (hadProgress && !silent) showToast("Test restarted with the new mode", "info");
}

function showCustomForm() {
  el.customForm.classList.remove("hidden");
  el.customInput.value = String(customSeconds);
  el.customModeBtn.setAttribute("aria-expanded", "true");
  window.requestAnimationFrame(() => {
    el.customInput.focus({ preventScroll: true });
    el.customInput.select();
  });
}

function hideCustomForm() {
  el.customForm.classList.add("hidden");
  el.customModeBtn.setAttribute("aria-expanded", "false");
}

function toggleCustomForm() {
  if (el.customForm.classList.contains("hidden")) showCustomForm();
  else hideCustomForm();
}

function startCustomTest() {
  const seconds = Math.round(Number(el.customInput.value));
  if (!Number.isFinite(seconds) || seconds < CUSTOM_TIME.min || seconds > CUSTOM_TIME.max) {
    showToast(`Choose a time between ${CUSTOM_TIME.min} and ${CUSTOM_TIME.max} seconds`, "warning");
    el.customInput.focus({ preventScroll: true });
    return;
  }
  customSeconds = seconds;
  saveSettings({ customSeconds });
  switchMode(customMode(), { focus: true, silent: true });
  showToast(`Custom ${seconds}s test — go!`, "info");
}

function applyTheme(nextTheme) {
  themePreference = nextTheme === "light" || nextTheme === "dark" ? nextTheme : "system";
  theme = resolveTheme(themePreference);
  document.documentElement.dataset.theme = theme;
  saveSettings({ theme: themePreference });
  el.themeToggle.setAttribute("aria-pressed", String(theme === "light"));
  el.themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  el.themeToggle.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  if (el.themeLabel) el.themeLabel.textContent = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#070912" : "#f4f5fb");

  if (state.result && isOverlayOpen()) {
    drawWpmChart(el.wpmChart, state.result.samples, state.result.duration);
  }
  drawSparkline(el.historyChart, getHistory().slice(0, 12).map((item) => item.wpm).reverse());
}

function applySound(nextSound) {
  sound = Boolean(nextSound);
  setSoundEnabled(sound);
  saveSettings({ sound });
  el.soundToggle.setAttribute("aria-pressed", String(sound));
  el.soundToggle.title = sound ? "Mute key sounds" : "Enable key sounds";
}

// ---- Personal records ------------------------------------------------
function renderRecords() {
  const history = getHistory();
  const stats = getStats();
  const recordModes = [...MODE_ORDER];
  if (isCustomMode(mode) && !recordModes.includes(mode)) recordModes.push(mode);
  const bests = Object.fromEntries(recordModes.map((item) => [item, getBest(item)]));

  el.testsCount.textContent = stats.tests ? `${stats.tests} ${stats.tests === 1 ? "test" : "tests"}` : "no tests yet";
  el.avgWpm.textContent = stats.tests ? String(stats.averageWpm) : "—";
  el.bestEver.textContent = stats.tests ? String(stats.bestWpm) : "—";
  el.streak.textContent = String(stats.streak);

  const fragment = document.createDocumentFragment();
  recordModes.forEach((item) => {
    const best = bests[item];
    const meta = getMode(item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "best-card";
    button.dataset.bestMode = item;
    button.classList.toggle("is-active", item === mode);
    button.classList.toggle("is-empty", !best);
    button.setAttribute(
      "aria-label",
      best
        ? `Start a ${meta.name}. Best ${Math.round(best.wpm)} words per minute at ${Math.round(best.accuracy)} percent accuracy.`
        : `Start a ${meta.name}. No record yet.`,
    );

    const label = document.createElement("span");
    label.className = "best-mode";
    label.textContent = meta.label;

    const value = document.createElement("strong");
    value.textContent = best ? String(Math.round(best.wpm)) : "—";
    if (best) {
      const unit = document.createElement("small");
      unit.textContent = "wpm";
      value.appendChild(unit);
    }

    const accuracy = document.createElement("span");
    accuracy.className = "best-acc";
    accuracy.textContent = best ? `${Math.round(best.accuracy)}% accuracy` : "no runs yet";

    button.append(label, value, accuracy);
    fragment.appendChild(button);
  });

  el.bestGrid.replaceChildren(fragment);
  drawSparkline(el.historyChart, history.slice(0, 12).map((item) => item.wpm).reverse());
}

// ---- Leaderboard -----------------------------------------------------
function syncBoardFilter() {
  const customBoard = isCustomMode(state.boardMode);
  el.boardFilter.querySelectorAll("[data-board-mode]").forEach((button) => {
    const active = customBoard ? button.dataset.boardMode === "custom" : button.dataset.boardMode === state.boardMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  el.boardSubtitle.textContent = `top 10 · ${getMode(state.boardMode).label}`;
}

function renderBoardLoading() {
  el.boardList.innerHTML = "";
  for (let index = 0; index < 5; index += 1) {
    const row = document.createElement("li");
    row.className = "board-row skeleton";
    row.innerHTML =
      '<span class="board-rank"></span><span class="board-avatar"></span>' +
      '<span class="board-player"><span class="skeleton-line"></span></span>' +
      '<span class="board-speed"><span class="skeleton-line short"></span></span>';
    el.boardList.appendChild(row);
  }
}

function renderBoardEmpty() {
  el.boardList.innerHTML = "";
  const row = document.createElement("li");
  row.className = "board-empty";
  row.innerHTML =
    '<span class="board-empty-icon">🏁</span>' +
    `<strong>No ${getMode(state.boardMode).label} scores yet.</strong>` +
    "<span>Finish a test and claim the first spot.</span>";
  el.boardList.appendChild(row);
}

function renderBoardError() {
  el.boardList.innerHTML = "";
  const row = document.createElement("li");
  row.className = "board-empty board-error";

  const icon = document.createElement("span");
  icon.className = "board-empty-icon";
  icon.textContent = "⚠";
  const title = document.createElement("strong");
  title.textContent = "Could not load the leaderboard.";
  const text = document.createElement("span");
  text.textContent = "Check that the Flask server is running.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "btn btn-ghost btn-small";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => loadBoard(state.boardMode));

  row.append(icon, title, text, retry);
  el.boardList.appendChild(row);
}

function renderBoard(scores, highlightId = null) {
  syncBoardFilter();
  if (!scores.length) {
    renderBoardEmpty();
    return;
  }

  el.boardList.innerHTML = "";
  scores.slice(0, 10).forEach((score, index) => {
    const rank = Number(score.rank) || index + 1;
    const name = String(score.name || "Anonymous").slice(0, 20);
    const initial = name.trim().charAt(0).toUpperCase() || "?";

    const row = document.createElement("li");
    row.className = "board-row";
    if (rank <= 3) row.classList.add(`rank-${rank}`);
    if (highlightId && score.id === highlightId) row.classList.add("is-you");
    row.title = `${Math.round(score.raw || score.wpm)} raw wpm · ${Math.round(score.consistency || 0)}% consistency`;

    const rankEl = document.createElement("span");
    rankEl.className = "board-rank";
    rankEl.textContent = String(rank);

    const avatar = document.createElement("span");
    avatar.className = "board-avatar";
    avatar.textContent = initial;
    avatar.setAttribute("aria-hidden", "true");

    const player = document.createElement("span");
    player.className = "board-player";
    const playerName = document.createElement("strong");
    playerName.textContent = name;
    const meta = document.createElement("small");
    meta.textContent = `${Math.round(score.accuracy)}% accuracy`;
    player.append(playerName, meta);

    const speed = document.createElement("span");
    speed.className = "board-speed";
    const speedValue = document.createElement("strong");
    speedValue.textContent = String(Math.round(score.wpm));
    const speedUnit = document.createElement("small");
    speedUnit.textContent = "wpm";
    speed.append(speedValue, speedUnit);

    if (highlightId && score.id === highlightId) {
      const tag = document.createElement("span");
      tag.className = "you-tag";
      tag.textContent = "you";
      playerName.appendChild(tag);
    }

    row.append(rankEl, avatar, player, speed);
    el.boardList.appendChild(row);
  });
}

async function loadBoard(boardMode, { highlightId = state.savedId } = {}) {
  const requested = boardMode === "custom" ? customMode() : boardMode;
  state.boardMode = isValidMode(requested) ? requested : "time-30";
  syncBoardFilter();

  if (state.boardRequest) state.boardRequest.abort();
  const controller = new AbortController();
  state.boardRequest = controller;

  renderBoardLoading();
  setConnection("checking");

  try {
    const scores = await fetchLeaderboard(state.boardMode, controller.signal);
    if (controller.signal.aborted) return;
    renderBoard(scores, highlightId);
    setConnection("online");
  } catch (error) {
    // An abort means a newer request replaced this one; a timeout is a real failure.
    if (controller.signal.aborted) return;
    renderBoardError();
    setConnection("offline");
  }
}

// ---- Event wiring ----------------------------------------------------
function bindEvents() {
  el.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.mode === "custom") {
        toggleCustomForm();
        return;
      }
      switchMode(button.dataset.mode);
    });
  });

  el.customForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startCustomTest();
  });

  el.cancelCustom.addEventListener("click", () => {
    hideCustomForm();
    el.customModeBtn.focus({ preventScroll: true });
  });

  el.boardFilter.querySelectorAll("[data-board-mode]").forEach((button) => {
    button.addEventListener("click", () => loadBoard(button.dataset.boardMode, { highlightId: null }));
  });

  el.bestGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-best-mode]");
    if (!button) return;
    switchMode(button.dataset.bestMode);
    el.testCard.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  });

  el.punctuation.addEventListener("change", () => {
    punctuation = el.punctuation.checked;
    saveSettings({ punctuation });
    startNewTest({ focus: true });
  });

  el.numbers.addEventListener("change", () => {
    numbers = el.numbers.checked;
    saveSettings({ numbers });
    startNewTest({ focus: true });
  });

  el.restart.addEventListener("click", () => restartTest());

  el.themeToggle.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"));
  const handleSystemTheme = () => {
    if (themePreference === "system") applyTheme("system");
  };
  if (themeQuery?.addEventListener) themeQuery.addEventListener("change", handleSystemTheme);
  else if (themeQuery?.addListener) themeQuery.addListener(handleSystemTheme);
  el.soundToggle.addEventListener("click", () => applySound(!sound));

  el.stage.addEventListener("click", () => {
    if (state.finished) return;
    el.input.focus({ preventScroll: true });
    setCaretEnd();
  });

  el.input.addEventListener("focus", () => {
    el.stage.classList.add("is-focused");
    setCaretEnd();
    positionCaret(el.input.value.length);
  });

  el.input.addEventListener("blur", () => {
    el.stage.classList.remove("is-focused");
  });

  el.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  });

  el.input.addEventListener("input", () => {
    if (state.finished) return;
    const typed = el.input.value;

    if (!state.running && typed.length > 0) startClock();

    if (typed.length > state.prevLen) {
      for (let index = state.prevLen; index < typed.length; index += 1) {
        state.keystrokes += 1;
        if (typed[index] !== state.text[index]) {
          state.errors += 1;
          playError();
        } else {
          playKey();
        }
      }
    }

    updateView();
    updateLiveStats();

    if (getMode(mode).kind === "quote" && typed.length >= state.text.length) {
      finishTest();
    }
  });

  ["paste", "drop"].forEach((type) => {
    el.input.addEventListener(type, (event) => {
      event.preventDefault();
      showToast("Pasting is disabled for a fair race", "warning");
    });
  });

  el.closeResult.addEventListener("click", () => restartTest());
  el.retryBtn.addEventListener("click", () => restartTest());
  el.nextBtn.addEventListener("click", nextTest);

  el.overlay.addEventListener("click", (event) => {
    if (event.target === el.overlay) restartTest();
  });

  el.saveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.result || el.saveBtn.disabled) return;

    const name = el.playerName.value.trim().slice(0, 20);
    saveSettings({ name });
    el.saveBtn.disabled = true;
    el.saveBtn.textContent = "Saving…";
    el.saveMsg.textContent = "";

    const result = state.result;
    try {
      const response = await saveScore({
        name,
        mode: result.mode,
        wpm: result.wpm,
        raw: result.raw,
        accuracy: result.accuracy,
        consistency: result.consistency,
        duration: result.duration,
        characters: {
          correct: result.correctChars,
          incorrect: Math.max(0, result.typedChars - result.correctChars),
          extra: 0,
          missed: 0,
        },
      });

      state.savedId = response?.id || null;
      el.saveBtn.textContent = "Saved ✓";
      const rank = Number(response?.rank);
      if (rank && rank <= 10) {
        el.saveMsg.textContent = `Saved — you are rank #${rank} on the ${getMode(result.mode).label} board.`;
      } else {
        el.saveMsg.textContent = "Saved! Keep pushing for a spot in the top 10.";
      }
      showToast("Score saved to the leaderboard", "success");

      state.boardMode = result.mode;
      await loadBoard(result.mode, { highlightId: state.savedId });
    } catch (error) {
      el.saveBtn.disabled = false;
      el.saveBtn.textContent = "Save to leaderboard";
      el.saveMsg.textContent =
        error.status === 429
          ? "Too many saves — wait a minute and try again."
          : error.message || "Could not save your score.";
      showToast("Could not save score", "error");
    }
  });

  el.shareBtn.addEventListener("click", async () => {
    if (!state.result) return;
    const result = state.result;
    const text = `Typing Race · ${getMode(result.mode).label} · ${Math.round(result.wpm)} WPM · ${round1(
      result.accuracy,
    )}% accuracy · ${Math.round(result.consistency)}% consistency`;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Result copied to clipboard", "success");
    } catch {
      const helper = document.createElement("textarea");
      helper.className = "copy-helper";
      helper.value = text;
      document.body.appendChild(helper);
      helper.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      helper.remove();
      showToast(copied ? "Result copied to clipboard" : "Could not copy — try again", copied ? "success" : "error");
    }
  });

  el.playerName.addEventListener("blur", () => {
    saveSettings({ name: el.playerName.value.trim().slice(0, 20) });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!el.customForm.classList.contains("hidden")) {
        event.preventDefault();
        hideCustomForm();
        el.customModeBtn.focus({ preventScroll: true });
        return;
      }
      if (document.activeElement === el.playerName) {
        el.playerName.blur();
        return;
      }
      event.preventDefault();
      restartTest();
      return;
    }

    if (isOverlayOpen()) {
      if (event.key === "Enter" && document.activeElement === el.resultCard) {
        event.preventDefault();
        restartTest();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const target = document.activeElement;
    const tag = target?.tagName;
    const isTextTarget =
      target && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable);
    const isActionTarget = target && (tag === "BUTTON" || tag === "A");
    // Keep native activation for buttons/links, but let any other key jump into the test.
    if (isTextTarget || (isActionTarget && (event.key === " " || event.key === "Enter"))) {
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      el.input.focus({ preventScroll: true });
      el.input.value += event.key;
      el.input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (event.key === "Backspace") {
      event.preventDefault();
      el.input.focus({ preventScroll: true });
      if (el.input.value.length) {
        el.input.value = el.input.value.slice(0, -1);
        el.input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });

  window.addEventListener("resize", () => {
    window.cancelAnimationFrame(state.resizeFrame);
    state.resizeFrame = window.requestAnimationFrame(() => {
      drawSparkline(el.historyChart, getHistory().slice(0, 12).map((item) => item.wpm).reverse());
      if (state.result && isOverlayOpen()) {
        drawWpmChart(el.wpmChart, state.result.samples, state.result.duration);
      }
      if (!state.finished) positionCaret(el.input.value.length);
    });
  });
}

// ---- Boot ------------------------------------------------------------
function init() {
  document.documentElement.dataset.theme = theme;
  applyModeUI();
  applySound(sound);
  applyTheme(themePreference);

  el.punctuation.checked = punctuation;
  el.numbers.checked = numbers;
  el.playerName.value = settings.name;
  el.customInput.min = String(CUSTOM_TIME.min);
  el.customInput.max = String(CUSTOM_TIME.max);
  el.customInput.value = String(customSeconds);

  bindEvents();
  startNewTest({ focus: false });
  renderRecords();
  loadBoard(mode);

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (!state.finished) positionCaret(el.input.value.length);
      drawSparkline(el.historyChart, getHistory().slice(0, 12).map((item) => item.wpm).reverse());
    });
  }
}

init();
