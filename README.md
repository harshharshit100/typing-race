# Typing Race

A polished typing speed test built with Flask and vanilla JavaScript. Pick a
mode, type against the clock, then review live WPM, accuracy, consistency and a
WPM-over-time chart. Save a result to a global, per-mode leaderboard.

![Flask](https://img.shields.io/badge/Flask-3.x-000?logo=flask)
![Vanilla JS](https://img.shields.io/badge/JavaScript-ES%20modules-f7df1e?logo=javascript&logoColor=000)
![No build step](https://img.shields.io/badge/build-none-34d399)

## Features

- **Four test modes** — 15 seconds, 30 seconds, 60 seconds and quote, plus a
  custom time anywhere from 5 to 300 seconds.
- **Live analytics** — timer, WPM, accuracy and progress while typing.
- **Real typing UX** — per-character highlighting, a smooth animated caret,
  scrolling lines, mobile keyboard support, and paste/drop protection.
- **Detailed results** — net WPM, raw WPM, accuracy, consistency, correct
  characters, errors, duration and a canvas WPM chart.
- **Personal records** — bests per mode, average WPM, best WPM, day streak and a
  recent-WPM sparkline, stored locally in `localStorage`.
- **Global leaderboard** — top 10 per mode, podium styling, highlighted personal
  score, per-mode filters and a live server-status pill.
- **Polish** — dark/light themes (a header switch that remembers your choice and
  follows your system theme until you pick one), optional WebAudio key sounds,
  toasts, keyboard shortcuts, reduced-motion support and a responsive layout.
- **Hardened API** — input validation, per-IP write rate limiting, atomic file
  writes, security headers and backwards-compatible legacy endpoints.
- **Zero build step** — plain ES modules and CSS.

## Quick start

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000>.

Set `PORT` or `FLASK_DEBUG` to change the server behaviour:

```bash
PORT=8080 FLASK_DEBUG=0 python app.py
```

## How scoring works

| Metric | Definition |
| --- | --- |
| Net WPM | `(correct characters / 5) / minutes` |
| Raw WPM | `(keystrokes / 5) / minutes`, including corrected mistakes |
| Accuracy | `(keystrokes - mistakes) / keystrokes` |
| Consistency | `100 - coefficient of variation` of each second's raw WPM |

Personal records live in `localStorage`; only scores you explicitly save are
sent to the server.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/leaderboard?mode=time-30&limit=10` | Top scores for one mode |
| `POST` | `/api/scores` | Save a score |
| `GET` | `/api/health` | Storage backend and available modes |
| `GET` | `/leaderboard` | Legacy flat top-10 list |
| `POST` | `/score` | Legacy save endpoint |

Valid modes: `time-15`, `time-30`, `time-60`, `quote`, plus `time-<seconds>` for
custom runs between 5 and 300 seconds. Each custom duration gets its own
leaderboard and local personal record.

Example:

```bash
curl -X POST http://127.0.0.1:5000/api/scores \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Ada",
    "mode": "time-30",
    "wpm": 88.4,
    "raw": 92.1,
    "accuracy": 97.2,
    "consistency": 84.0,
    "duration": 30,
    "characters": {"correct": 221, "incorrect": 4}
  }'
```

The response includes the saved score's id and leaderboard rank:

```json
{"message": "Score saved", "id": "…", "rank": 3}
```

## Storage

- **Local development:** scores are written atomically to `scores.json` and
  trimmed to the top 10 per mode.
- **Serverless / Vercel:** set `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or
  `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) and scores are stored in
  Upstash Redis under one sorted set per mode.

Legacy scores without a `mode` field are treated as quote scores.

## Tests

```bash
python -m unittest discover -s tests -v
```

The suite covers page rendering, security headers, score validation, per-mode
isolation, top-10 trimming, legacy data compatibility and the legacy endpoints.

## Project structure

```text
app.py                    Flask app, validation, storage and API
requirements.txt
templates/
  index.html              Semantic markup and inline SVG icons
static/
  style.css               Design system, themes, responsive layout
  js/
    app.js                Typing engine, UI state and event wiring
    data.js               Word bank, quotes and text generation
    store.js              localStorage settings, history and records
    api.js                Fetch wrappers
    chart.js              Canvas WPM chart and sparkline
    sound.js              WebAudio key/error/finish sounds
    theme-init.js         Prevents a flash of the wrong theme
tests/
  test_app.py             API and storage tests
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Any printable key | Focus the test and start typing |
| `Backspace` | Delete the last character (also from outside the test) |
| `Esc` | Restart with fresh text |
| `Enter` | Retry from the results screen |

## Notes

- Fonts are loaded from Google Fonts with system fallbacks; the app still works
  offline.
- The leaderboard is intentionally fair-play: paste and drop are blocked in the
  typing surface.
- Names are capped at 20 characters and stripped of control characters.
