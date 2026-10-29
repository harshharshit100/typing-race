// ---- Data ----------------------------------------------------------
const SENTENCES = [
  "The quick brown fox jumps over the lazy dog.",
  "Practice makes progress, not perfection.",
  "A journey of a thousand miles begins with a single step.",
  "Typing fast is easy once your fingers remember the keys.",
  "Coding is like cooking: small steps make a great meal.",
  "Every expert was once a beginner who refused to quit.",
  "Python and JavaScript make a great team for the web.",
  "Good design is invisible, but bad design is unforgettable."
];

// ---- Elements ------------------------------------------------------
const quoteEl = document.getElementById("quote");
const inputEl = document.getElementById("input");
const timerEl = document.getElementById("timer");
const wpmEl = document.getElementById("wpm");
const accEl = document.getElementById("accuracy");
const resultEl = document.getElementById("result");
const summaryEl = document.getElementById("summary");
const nameEl = document.getElementById("name");
const saveBtn = document.getElementById("save");
const saveMsg = document.getElementById("saveMsg");
const restartBtn = document.getElementById("restart");
const boardEl = document.getElementById("leaderboard");

// ---- State ---------------------------------------------------------
let quote = "";
let startTime = null;
let timerId = null;
let errors = 0;      // every wrong character typed, even if later fixed
let prevLen = 0;
let finished = false;
let finalWpm = 0;
let finalAcc = 100;

// ---- Helpers -------------------------------------------------------
function pickSentence() {
  return SENTENCES[Math.floor(Math.random() * SENTENCES.length)];
}

function renderQuote() {
  quoteEl.innerHTML = "";
  for (const ch of quote) {
    const span = document.createElement("span");
    span.textContent = ch;
    quoteEl.appendChild(span);
  }
  updateHighlight("");
}

function updateHighlight(typed) {
  const spans = quoteEl.children;
  for (let i = 0; i < spans.length; i++) {
    spans[i].className = "";
    if (i < typed.length) {
      spans[i].classList.add(typed[i] === quote[i] ? "correct" : "wrong");
    } else if (i === typed.length) {
      spans[i].classList.add("current");
    }
  }
}

function calcStats(typed, seconds) {
  const minutes = Math.max(seconds, 0.001) / 60;
  const wpm = (typed.length / 5) / minutes;
  const total = typed.length || 1;
  const accuracy = Math.max(0, ((total - errors) / total) * 100);
  return { wpm, accuracy };
}

function tick() {
  const seconds = (Date.now() - startTime) / 1000;
  timerEl.textContent = seconds.toFixed(1);
  const { wpm } = calcStats(inputEl.value, seconds);
  wpmEl.textContent = Math.round(wpm);
}

// ---- Game flow -----------------------------------------------------
function newRound() {
  clearInterval(timerId);
  quote = pickSentence();
  startTime = null;
  errors = 0;
  prevLen = 0;
  finished = false;
  inputEl.value = "";
  inputEl.disabled = false;
  timerEl.textContent = "0.0";
  wpmEl.textContent = "0";
  accEl.textContent = "100";
  resultEl.classList.add("hidden");
  saveMsg.textContent = "";
  saveBtn.disabled = false;
  renderQuote();
  inputEl.focus();
}

function finishRound() {
  finished = true;
  clearInterval(timerId);
  inputEl.disabled = true;

  const seconds = (Date.now() - startTime) / 1000;
  const { wpm, accuracy } = calcStats(inputEl.value, seconds);
  finalWpm = Math.round(wpm * 10) / 10;
  finalAcc = Math.round(accuracy * 10) / 10;

  timerEl.textContent = seconds.toFixed(1);
  wpmEl.textContent = Math.round(finalWpm);
  accEl.textContent = Math.round(finalAcc);
  summaryEl.textContent = `You typed at ${finalWpm} WPM with ${finalAcc}% accuracy.`;
  resultEl.classList.remove("hidden");
  nameEl.focus();
}

inputEl.addEventListener("input", () => {
  if (finished) return;
  const typed = inputEl.value;

  // Start the clock on the first character
  if (startTime === null && typed.length > 0) {
    startTime = Date.now();
    timerId = setInterval(tick, 100);
  }

  // Count a mistake each time a new wrong character is typed
  if (typed.length > prevLen) {
    const i = typed.length - 1;
    if (typed[i] !== quote[i]) errors++;
  }
  prevLen = typed.length;

  updateHighlight(typed);

  const { accuracy } = calcStats(typed, (Date.now() - startTime) / 1000);
  accEl.textContent = Math.round(accuracy);

  if (typed.length >= quote.length) finishRound();
});

// Stop copy-pasting the sentence
inputEl.addEventListener("paste", (e) => e.preventDefault());

restartBtn.addEventListener("click", newRound);

// ---- Leaderboard (talks to Flask) ----------------------------------
async function loadLeaderboard() {
  try {
    const res = await fetch("/leaderboard");
    const scores = await res.json();
    boardEl.innerHTML = "";
    if (scores.length === 0) {
      boardEl.innerHTML = "<li>No scores yet. Be the first!</li>";
      return;
    }
    for (const s of scores) {
      const li = document.createElement("li");
      li.textContent = `${s.name} - ${s.wpm} WPM (${s.accuracy}%)`;
      boardEl.appendChild(li);
    }
  } catch (err) {
    boardEl.innerHTML = "<li>Could not load leaderboard.</li>";
  }
}

saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  try {
    const res = await fetch("/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameEl.value, wpm: finalWpm, accuracy: finalAcc })
    });
    saveMsg.textContent = res.ok ? "Score saved!" : "Could not save score.";
    if (res.ok) loadLeaderboard();
  } catch (err) {
    saveMsg.textContent = "Could not reach the server.";
    saveBtn.disabled = false;
  }
});

// ---- Start ---------------------------------------------------------
newRound();
loadLeaderboard();