import json
import os
import tempfile
import unittest

import app as app_module


class TypingRaceApiTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.original_file = app_module.SCORES_FILE
        self.original_redis = app_module.redis
        self.original_limit = app_module.RATE_LIMIT

        app_module.SCORES_FILE = os.path.join(self.tempdir.name, "scores.json")
        app_module.redis = None
        app_module.RATE_LIMIT = 10_000
        app_module._rate_buckets.clear()
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.SCORES_FILE = self.original_file
        app_module.redis = self.original_redis
        app_module.RATE_LIMIT = self.original_limit
        app_module._rate_buckets.clear()
        self.tempdir.cleanup()

    def save(self, **overrides):
        payload = {
            "name": "Ada",
            "mode": "time-30",
            "wpm": 82.4,
            "raw": 86.1,
            "accuracy": 97.2,
            "consistency": 88.5,
            "duration": 30,
            "characters": {"correct": 206, "incorrect": 4},
        }
        payload.update(overrides)
        return self.client.post("/api/scores", json=payload)

    def test_home_renders(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Typing Race", response.data)
        self.assertNotIn(b"TypeRush", response.data)
        self.assertIn(b"leaderboard", response.data)

    def test_theme_switcher_is_wired_up(self):
        response = self.client.get("/")
        self.assertIn(b'data-theme="dark"', response.data)
        self.assertIn(b'id="themeToggle"', response.data)
        self.assertIn(b"theme-init.js", response.data)
        self.assertIn(b"style.css", response.data)

    def test_security_headers(self):
        response = self.client.get("/")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])

    def test_empty_leaderboard(self):
        response = self.client.get("/api/leaderboard?mode=time-30")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"mode": "time-30", "scores": []})

    def test_save_and_read_score(self):
        response = self.save()
        self.assertEqual(response.status_code, 201)
        body = response.get_json()
        self.assertEqual(body["rank"], 1)
        self.assertTrue(body["id"])

        board = self.client.get("/api/leaderboard?mode=time-30").get_json()
        self.assertEqual(len(board["scores"]), 1)
        score = board["scores"][0]
        self.assertEqual(score["name"], "Ada")
        self.assertEqual(score["wpm"], 82.4)
        self.assertEqual(score["accuracy"], 97.2)
        self.assertEqual(score["rank"], 1)
        self.assertEqual(score["mode"], "time-30")

    def test_modes_have_separate_boards(self):
        self.save(mode="time-30", wpm=80)
        self.save(mode="time-15", wpm=90)
        self.save(mode="quote", wpm=70)

        self.assertEqual(self.client.get("/api/leaderboard?mode=time-30").get_json()["scores"][0]["wpm"], 80)
        self.assertEqual(self.client.get("/api/leaderboard?mode=time-15").get_json()["scores"][0]["wpm"], 90)
        self.assertEqual(self.client.get("/api/leaderboard?mode=quote").get_json()["scores"][0]["wpm"], 70)

    def test_custom_time_mode_has_its_own_board(self):
        self.save(mode="time-45", wpm=70)
        self.save(mode="time-45", wpm=75)
        self.save(mode="time-30", wpm=80)

        custom = self.client.get("/api/leaderboard?mode=time-45").get_json()["scores"]
        self.assertEqual([score["wpm"] for score in custom], [75, 70])
        self.assertTrue(all(score["mode"] == "time-45" for score in custom))

        preset = self.client.get("/api/leaderboard?mode=time-30").get_json()["scores"]
        self.assertEqual([score["wpm"] for score in preset], [80])

    def test_custom_time_bounds(self):
        self.assertEqual(self.save(mode="time-4").status_code, 400)
        self.assertEqual(self.save(mode="time-301").status_code, 400)
        self.assertEqual(self.save(mode="time-abc").status_code, 400)
        self.assertEqual(self.save(mode="time-45").status_code, 201)

    def test_keeps_only_top_ten(self):
        for index in range(13):
            self.save(wpm=40 + index, name=f"Player {index}")

        scores = self.client.get("/api/leaderboard?mode=time-30").get_json()["scores"]
        self.assertEqual(len(scores), 10)
        self.assertEqual(scores[0]["wpm"], 52)
        self.assertEqual(scores[-1]["wpm"], 43)

    def test_legacy_scores_get_quote_mode(self):
        with open(app_module.SCORES_FILE, "w", encoding="utf-8") as handle:
            json.dump([{"name": "Old Timer", "wpm": 61, "accuracy": 94}], handle)

        scores = self.client.get("/api/leaderboard?mode=quote").get_json()["scores"]
        self.assertEqual(len(scores), 1)
        self.assertEqual(scores[0]["mode"], "quote")

    def test_validation(self):
        self.assertEqual(self.save(mode="not-real").status_code, 400)
        self.assertEqual(self.save(wpm=9999).status_code, 400)
        self.assertEqual(self.save(accuracy=-1).status_code, 400)
        self.assertEqual(self.save(wpm="fast").status_code, 400)

    def test_name_is_cleaned(self):
        response = self.save(name="   \t  ")
        self.assertEqual(response.status_code, 201)
        scores = self.client.get("/api/leaderboard?mode=time-30").get_json()["scores"]
        self.assertEqual(scores[0]["name"], "Anonymous")

    def test_legacy_endpoints(self):
        response = self.client.post("/score", json={"name": "Legacy", "mode": "time-30", "wpm": 55, "accuracy": 91})
        self.assertEqual(response.status_code, 201)
        board = self.client.get("/leaderboard").get_json()
        self.assertIsInstance(board, list)
        self.assertEqual(board[0]["name"], "Legacy")

    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["storage"], "json")
        self.assertIn("time-30", body["modes"])
        self.assertEqual(body["customTime"], {"min": 5, "max": 300})


if __name__ == "__main__":
    unittest.main()
