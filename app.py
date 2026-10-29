"""Typing Race — a fast, polished typing speed test.

Scores are kept per mode (15s / 30s / 60s / quote / custom ``time-<seconds>``).
On serverless hosts such as Vercel the filesystem is read-only, so when Upstash
Redis credentials are present scores live in Redis. Locally the app falls back
to an atomically written JSON file.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.json.sort_keys = False

MAX_SCORES = 10
MODES = ("time-15", "time-30", "time-60", "quote")
DEFAULT_MODE = "time-30"
LEGACY_MODE = "quote"  # old sentence-based scores are treated as quote tests
CUSTOM_MODE_RE = re.compile(r"^time-(\d{1,3})$")
MIN_CUSTOM_SECONDS = 5
MAX_CUSTOM_SECONDS = 300

REDIS_KEY = "typing-race:leaderboard"
SCORES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scores.json")

REDIS_URL = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
REDIS_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")

redis = None
if REDIS_URL and REDIS_TOKEN:
    from upstash_redis import Redis

    redis = Redis(url=REDIS_URL, token=REDIS_TOKEN)

_storage_lock = threading.Lock()
_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}
RATE_LIMIT = 30  # saves per IP...
RATE_WINDOW = 60  # ...per 60 seconds


# ---- Validation ------------------------------------------------------
def _clean_name(raw: object) -> str:
    name = re.sub(r"[\x00-\x1f\x7f]", "", str(raw or "")).strip()
    return name[:20] or "Anonymous"


def _number(data: dict, key: str, low: float, high: float, default: float = 0.0) -> float:
    try:
        value = float(data.get(key, default))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be a number") from exc
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{key} is out of range")
    return round(value, 1)


def _characters(data: dict) -> dict:
    raw = data.get("characters")
    if not isinstance(raw, dict):
        return {}
    clean = {}
    for key in ("correct", "incorrect", "extra", "missed"):
        try:
            value = int(raw.get(key, 0))
        except (TypeError, ValueError):
            value = 0
        clean[key] = max(0, min(value, 100_000))
    return clean


def _sort_key(score: dict):
    return (-float(score.get("wpm", 0)), -float(score.get("accuracy", 0)), score.get("timestamp", ""))


def is_valid_mode(mode: object) -> bool:
    """Fixed presets plus per-duration custom modes such as ``time-45``."""
    if mode in MODES:
        return True
    match = CUSTOM_MODE_RE.match(str(mode or ""))
    if not match:
        return False
    return MIN_CUSTOM_SECONDS <= int(match.group(1)) <= MAX_CUSTOM_SECONDS


def _mode_of(score: dict) -> str:
    mode = score.get("mode")
    return mode if is_valid_mode(mode) else LEGACY_MODE


# ---- Storage helpers -------------------------------------------------
def _read_scores_file() -> list[dict]:
    if not os.path.exists(SCORES_FILE):
        return []
    try:
        with open(SCORES_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (json.JSONDecodeError, OSError):
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def _write_scores_file(scores: list[dict]) -> None:
    directory = os.path.dirname(SCORES_FILE) or "."
    os.makedirs(directory, exist_ok=True)
    temp = f"{SCORES_FILE}.{os.getpid()}.{threading.get_ident()}.tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(scores, handle, indent=2, ensure_ascii=False)
    os.replace(temp, SCORES_FILE)


def _coerce_entry(member: object, fallback_mode: str | None = None) -> dict | None:
    if isinstance(member, str):
        try:
            member = json.loads(member)
        except json.JSONDecodeError:
            return None
    if not isinstance(member, dict):
        return None
    entry = dict(member)
    entry.setdefault("id", uuid.uuid4().hex)
    entry.setdefault("mode", fallback_mode or LEGACY_MODE)
    entry.setdefault("name", "Anonymous")
    entry.setdefault("wpm", 0)
    entry.setdefault("accuracy", 0)
    return entry


def get_top_scores(mode: str | None = None, limit: int = MAX_SCORES) -> list[dict]:
    """Return the best scores, optionally filtered to a single mode."""
    limit = max(1, min(int(limit), MAX_SCORES))

    if redis:
        if mode:
            keys = [f"{REDIS_KEY}:{mode}"]
            if mode == LEGACY_MODE:
                keys.append(REDIS_KEY)  # scores written by older versions
        else:
            keys = [REDIS_KEY] + [f"{REDIS_KEY}:{item}" for item in MODES]

        found: dict[str, dict] = {}
        for key in keys:
            try:
                members = redis.zrange(key, 0, limit - 1, rev=True)
            except Exception:  # a single bad key should not break the board
                continue
            fallback = LEGACY_MODE if key == REDIS_KEY else key.rsplit(":", 1)[-1]
            for member in members or []:
                entry = _coerce_entry(member, fallback)
                if not entry:
                    continue
                entry["mode"] = _mode_of(entry)
                if mode and entry["mode"] != mode:
                    continue
                found[str(entry["id"])] = entry

        scores = sorted(found.values(), key=_sort_key)[:limit]
        return scores

    with _storage_lock:
        scores = _read_scores_file()

    for score in scores:
        score["mode"] = _mode_of(score)
    if mode:
        scores = [score for score in scores if score["mode"] == mode]
    scores.sort(key=_sort_key)
    return scores[:limit]


def add_score(entry: dict) -> str:
    """Persist one score and return its id."""
    entry = dict(entry)
    entry["id"] = uuid.uuid4().hex
    entry["timestamp"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if redis:
        key = f"{REDIS_KEY}:{entry['mode']}"
        member = json.dumps(entry, separators=(",", ":"), ensure_ascii=False)
        redis.zadd(key, {member: entry["wpm"]})
        redis.zremrangebyrank(key, 0, -(MAX_SCORES + 1))  # keep the top 10
        return entry["id"]

    with _storage_lock:
        scores = _read_scores_file()
        scores.append(entry)

        grouped: dict[str, list[dict]] = defaultdict(list)
        for score in scores:
            grouped[_mode_of(score)].append(score)

        trimmed: list[dict] = []
        for items in grouped.values():
            items.sort(key=_sort_key)
            trimmed.extend(items[:MAX_SCORES])
        _write_scores_file(trimmed)

    return entry["id"]


def _rank_of(score_id: str, mode: str) -> int | None:
    for index, score in enumerate(get_top_scores(mode, MAX_SCORES), start=1):
        if score.get("id") == score_id:
            return index
    return None


def _public_score(score: dict, rank: int | None = None) -> dict:
    return {
        "id": score.get("id", ""),
        "rank": rank,
        "name": score.get("name", "Anonymous"),
        "wpm": score.get("wpm", 0),
        "raw": score.get("raw", score.get("wpm", 0)),
        "accuracy": score.get("accuracy", 0),
        "consistency": score.get("consistency", 0),
        "mode": _mode_of(score),
        "timestamp": score.get("timestamp"),
    }


# ---- Abuse protection ------------------------------------------------
def _client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",")[0].strip() or request.remote_addr or "unknown"


def _rate_limited() -> bool:
    now = time.time()
    ip = _client_ip()
    with _rate_lock:
        attempts = [stamp for stamp in _rate_buckets.get(ip, []) if now - stamp < RATE_WINDOW]
        if len(attempts) >= RATE_LIMIT:
            _rate_buckets[ip] = attempts
            return True
        attempts.append(now)
        _rate_buckets[ip] = attempts

        if len(_rate_buckets) > 2_000:  # simple memory cap
            for key in [key for key, value in _rate_buckets.items() if not value or now - value[-1] > RATE_WINDOW]:
                _rate_buckets.pop(key, None)
    return False


# ---- Routes ----------------------------------------------------------
@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/leaderboard")
def api_leaderboard():
    mode = request.args.get("mode") or None
    if mode and not is_valid_mode(mode):
        return jsonify({"error": "unknown mode"}), 400

    limit = request.args.get("limit", type=int) or MAX_SCORES
    try:
        scores = get_top_scores(mode, limit)
    except Exception:
        app.logger.exception("Could not read leaderboard")
        return jsonify({"mode": mode or "all", "scores": []})

    return jsonify(
        {
            "mode": mode or "all",
            "scores": [_public_score(score, index) for index, score in enumerate(scores, start=1)],
        }
    )


@app.get("/api/health")
def api_health():
    return jsonify(
        {
            "status": "ok",
            "storage": "redis" if redis else "json",
            "modes": list(MODES),
            "customTime": {"min": MIN_CUSTOM_SECONDS, "max": MAX_CUSTOM_SECONDS},
            "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    )


def _save_score():
    if _rate_limited():
        return jsonify({"error": "Too many saves. Try again in a minute."}), 429

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON body"}), 400

    mode = str(data.get("mode") or DEFAULT_MODE)
    if not is_valid_mode(mode):
        return jsonify({"error": "unknown mode"}), 400

    try:
        wpm = _number(data, "wpm", 0, 400)
        entry = {
            "name": _clean_name(data.get("name")),
            "wpm": wpm,
            "raw": _number(data, "raw", 0, 500, default=wpm),
            "accuracy": _number(data, "accuracy", 0, 100),
            "consistency": _number(data, "consistency", 0, 100),
            "duration": _number(data, "duration", 0, 3_600),
            "characters": _characters(data),
            "mode": mode,
        }
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        score_id = add_score(entry)
    except Exception:
        app.logger.exception("Could not save score")
        return jsonify({"error": "storage unavailable"}), 503

    try:
        rank = _rank_of(score_id, mode)
    except Exception:
        rank = None

    return (
        jsonify(
            {
                "message": "Score saved",
                "id": score_id,
                "rank": rank,
            }
        ),
        201,
    )


@app.post("/api/scores")
def api_scores():
    return _save_score()


@app.post("/score")  # backwards-compatible endpoint
def add_score_legacy():
    return _save_score()


@app.get("/leaderboard")
def leaderboard():
    """Backwards-compatible: a flat list of the best scores."""
    try:
        scores = get_top_scores(None, MAX_SCORES)
    except Exception:
        scores = []
    return jsonify([_public_score(score) for score in scores])


# ---- Security headers ------------------------------------------------
@app.after_request
def secure_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    )
    return response


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG", "1") == "1", port=int(os.environ.get("PORT", "5000")))
