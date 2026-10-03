"""Local smoke tests for ReelDirector services and media rendering."""
import asyncio
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
import imageio_ffmpeg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class BackendTests(unittest.TestCase):
    def test_health_and_auth_guard(self):
        async def run():
            transport = httpx.ASGITransport(app=server.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                root = await client.get("/")
                health = await client.get("/api/")
                unauthenticated = await client.get("/api/auth/me")
                return root, health, unauthenticated

        root, health, unauthenticated = asyncio.run(run())
        self.assertEqual(root.status_code, 200)
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["database"], "supabase")
        self.assertFalse(health.json()["supabase_configured"])
        self.assertEqual(unauthenticated.status_code, 401)

    def test_json_extraction_handles_model_fences(self):
        self.assertEqual(server.extract_json('```json\n{"instruction":"Pan left"}\n```'),
                         {"instruction": "Pan left"})

    def test_gemini_retries_transient_service_errors(self):
        unavailable = Mock(status_code=503, headers={})
        ready = Mock(status_code=200, headers={})
        ready.json.return_value = {"candidates": [{"content": {"parts": [{"text": "ready"}]}}]}
        with patch.object(server, "GEMINI_API_KEY", "test-key"), \
             patch.object(server.requests, "post", side_effect=[unavailable, unavailable, ready]) as post, \
             patch.object(server.time, "sleep") as sleep, \
             patch.object(server.random, "uniform", return_value=0):
            self.assertEqual(server._send_gemini_response("system", "prompt"), "ready")
        self.assertEqual(post.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_storyboard_fallback_matches_requested_duration(self):
        shots = server.fallback_storyboard({
            "duration_seconds": 45, "shoot_type": "real_estate", "mood": "luxury",
        })
        self.assertGreaterEqual(len(shots), 4)
        self.assertLessEqual(len(shots), 8)
        self.assertAlmostEqual(sum(shot["duration_seconds"] for shot in shots), 45, places=1)
        self.assertTrue(all(shot["direction"] and shot["status"] == "pending" for shot in shots))

    def test_storyboard_endpoint_persists_fallback_when_ai_is_unavailable(self):
        doc = {
            "id": "p", "user_id": "u", "title": "Home tour", "shoot_type": "real_estate",
            "purpose": "", "mood": "luxury", "style": "luxury", "platform": "instagram_reel",
            "duration_seconds": 45, "audience": "", "storyboard": None,
        }

        async def fake_project(*_args):
            return doc.copy()

        async def unavailable_ai(*_args):
            raise RuntimeError("Gemini is temporarily unavailable")

        async def save_doc(value, _user_id):
            doc.update(value)

        with patch.object(server, "fetch_project", fake_project), \
             patch.object(server, "chat_once", unavailable_ai), \
             patch.object(server, "save_project", save_doc):
            result = asyncio.run(server.generate_storyboard("p", user={"id": "u"}))

        self.assertFalse(result["ai_generated"])
        self.assertFalse(doc["storyboard_ai_generated"])
        self.assertAlmostEqual(sum(shot["duration_seconds"] for shot in result["storyboard"]), 45, places=1)

    def test_supabase_client_startup_and_shutdown(self):
        old_url, old_key = server.SUPABASE_URL, server.SUPABASE_SECRET_KEY

        async def run():
            server.SUPABASE_URL = "https://example.supabase.co"
            server.SUPABASE_SECRET_KEY = "not-a-real-key"
            await server._startup()
            self.assertIsNotNone(server.supabase)
            await server._shutdown()
            server.supabase = None

        try:
            asyncio.run(run())
        finally:
            server.SUPABASE_URL, server.SUPABASE_SECRET_KEY = old_url, old_key
            server.supabase = None

    def test_director_uses_storyboard_fallback_without_ai(self):
        async def fake_project(*_args):
            return {"storyboard": [{
                "title": "Close-up", "description": "Frame the subject closely.",
                "camera_movement": "static", "shot_size": "close_up",
                "direction": "Move closer slowly",
            }]}

        async def unavailable_ai(*_args):
            raise RuntimeError("GEMINI_API_KEY is not configured")

        with patch.object(server, "fetch_project", fake_project), patch.object(server, "chat_once", unavailable_ai):
            result = asyncio.run(server.director_instruct(
                server.DirectorInstructionIn(project_id="p", shot_index=0), user={"id": "u"},
            ))

        self.assertEqual(result["instruction"], "Move closer slowly")
        self.assertFalse(result["ready"])
        self.assertEqual(result["confidence"], 0)

    def test_frame_review_marks_unavailable_without_fake_score(self):
        async def fake_project(*_args):
            return {"id": "p"}

        async def unavailable_ai(*_args):
            raise RuntimeError("GEMINI_API_KEY is not configured")

        with patch.object(server, "fetch_project", fake_project), patch.object(server, "chat_once", unavailable_ai):
            result = asyncio.run(server.clip_quality(
                server.ClipQualityIn(project_id="p", shot_index=0, frame_base64="aGVsbG8=", duration_seconds=2),
                user={"id": "u"},
            ))

        self.assertFalse(result["review_available"])
        self.assertIn("manually", result["reason"])

    def test_video_render_preserves_audio_and_mixes_music(self):
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory(prefix="reeldirector-render-test-") as folder:
            temp = Path(folder)
            clip = temp / "clip-0.mp4"
            silent_clip = temp / "silent.mp4"
            music = temp / "music.m4a"
            subprocess.run([
                ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=24:d=1",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(clip),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            subprocess.run([
                ffmpeg, "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=1",
                "-c:a", "aac", str(music),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            subprocess.run([
                ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=green:s=320x240:r=24:d=1",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(silent_clip),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            concat = temp / "clips.txt"
            concat.write_text("file 'clip-0.mp4'\n")

            for style, soundtrack in (("cinematic", None), ("warm", music), ("fast_pace", music)):
                output = temp / f"{style}.mp4"
                server._run_video_render(concat, output, 720, 1280, soundtrack, 30, style)
                self.assertGreater(output.stat().st_size, 1_000)

            concat.write_text("file 'silent.mp4'\n")
            output = temp / "music-only.mp4"
            server._run_video_render(concat, output, 720, 1280, music, 30, "cinematic")
            self.assertGreater(output.stat().st_size, 1_000)


if __name__ == "__main__":
    unittest.main()
