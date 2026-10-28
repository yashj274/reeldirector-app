"""Local smoke tests for ReelDirector services and media rendering."""
import asyncio
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import httpx
import imageio_ffmpeg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class BackendTests(unittest.TestCase):
    def test_auto_edit_suggestions_are_bounded_to_real_clips(self):
        shots = [
            {"shot_index": 2, "source_duration_seconds": 4.0},
            {"shot_index": 5, "source_duration_seconds": 6.0},
        ]
        result = server.normalize_auto_edit_result({
            "clip_order": [5, 2],
            "clips": [
                {"shot_index": 5, "trim_start_seconds": -1, "trim_end_seconds": 8, "playback_rate": 3},
                {"shot_index": 2, "trim_start_seconds": 1, "trim_end_seconds": 2, "playback_rate": 0.75},
            ],
            "editing_style": "fast_pace", "summary": "A tighter opening.",
        }, shots, "cinematic")
        self.assertEqual(result["clip_order"], [5, 2])
        self.assertEqual(result["clip_edits"][0], {
            "shot_index": 5, "trim_start_seconds": 0, "trim_end_seconds": 6, "playback_rate": 1,
        })
        self.assertEqual(result["clip_edits"][1]["playback_rate"], 0.75)

    def test_auto_edit_rejects_missing_or_duplicate_clips(self):
        shots = [{"shot_index": 0, "source_duration_seconds": 2.0}]
        with self.assertRaises(ValueError):
            server.normalize_auto_edit_result({"clip_order": [], "clips": []}, shots, "cinematic")
        with self.assertRaises(ValueError):
            server.normalize_auto_edit_result({
                "clip_order": [0],
                "clips": [{"shot_index": 0}, {"shot_index": 0}],
            }, shots, "cinematic")

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

    def test_project_recommendations_accept_only_supported_ai_choices(self):
        async def run():
            valid = '{"shoot_type":"wedding","style":"cinematic","mood":"Emotional"}'
            with patch.object(server, "GEMINI_API_KEY", "test-key"), patch.object(server, "chat_once", new=AsyncMock(return_value=valid)):
                result = await server.recommend_project_settings(
                    server.ProjectRecommendationIn(title="Mehndi", purpose="A family mehndi celebration"),
                    user={"id": "test-user"},
                )
                self.assertEqual(result, {"shoot_type": "wedding", "style": "cinematic", "mood": "Emotional"})

            invalid = '{"shoot_type":"invented","style":"cinematic","mood":"Emotional"}'
            with patch.object(server, "GEMINI_API_KEY", "test-key"), patch.object(server, "chat_once", new=AsyncMock(return_value=invalid)):
                with self.assertRaises(server.HTTPException) as failure:
                    await server.recommend_project_settings(
                        server.ProjectRecommendationIn(title="Test", purpose="A sufficiently long description"),
                        user={"id": "test-user"},
                    )
                self.assertEqual(failure.exception.status_code, 503)

            with self.assertRaises(server.HTTPException) as short_description:
                await server.recommend_project_settings(
                    server.ProjectRecommendationIn(title="Test", purpose="Too short"),
                    user={"id": "test-user"},
                )
            self.assertEqual(short_description.exception.status_code, 422)

        asyncio.run(run())

    def test_admin_access_uses_normalized_server_allowlist(self):
        with patch.object(server, "ADMIN_EMAILS", {"admin@example.com"}):
            self.assertTrue(server.is_admin_email("Admin@Example.com"))
            self.assertFalse(server.is_admin_email("user@example.com"))
            self.assertFalse(server.is_admin_email(None))

    def test_admin_routes_reject_non_admin_accounts(self):
        async def run():
            server.app.dependency_overrides[server.current_user] = lambda: {
                "id": "user-1", "email": "user@example.com", "is_admin": False,
            }
            try:
                transport = httpx.ASGITransport(app=server.app)
                async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                    return await client.get("/api/admin/overview")
            finally:
                server.app.dependency_overrides.pop(server.current_user, None)

        with patch.object(server, "ADMIN_EMAILS", {"admin@example.com"}):
            response = asyncio.run(run())
        self.assertEqual(response.status_code, 403)

    def test_admin_project_summary_does_not_return_private_media_fields(self):
        summary = server._admin_project_summary({
            "id": "p1", "user_id": "u1", "created_at": "2026-10-20", "updated_at": "2026-10-20",
            "data": {"title": "Office", "shoot_type": "business", "status": "editing",
                     "clips": [{"video_url": "https://private.example/video", "frame_base64": "secret"}]},
        })
        self.assertEqual(summary["clip_count"], 1)
        self.assertNotIn("video_url", summary)
        self.assertNotIn("frame_base64", summary)

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
        _, shots = server.fallback_storyboard({
            "duration_seconds": 45, "shoot_type": "real_estate", "mood": "luxury",
        })
        self.assertGreaterEqual(len(shots), 4)
        self.assertLessEqual(len(shots), 8)
        self.assertAlmostEqual(sum(shot["duration_seconds"] for shot in shots), 45, places=1)
        self.assertTrue(all(shot["direction"] and shot["status"] == "pending" for shot in shots))

    def test_structured_storyboard_maps_to_compatible_shot_fields(self):
        source = [{
            "title": f"Shot {index + 1}", "description": "Show the subject clearly.",
            "purpose": ("hook", "detail", "action", "cta")[index],
            "shotType": "close_up", "duration": 2, "cameraMovement": "dolly_in",
            "instruction": "Move closer slowly.", "voiceover": "", "onScreenText": "",
        } for index in range(4)]
        shots = server.normalise_storyboard(source)

        self.assertEqual(shots[0]["shotNumber"], 1)
        self.assertEqual(shots[0]["index"], 0)
        self.assertEqual(shots[0]["camera_movement"], "dolly_in")
        self.assertEqual(shots[0]["duration_seconds"], 2)
        self.assertEqual(shots[-1]["purpose"], "cta")

    def test_storyboard_endpoint_preserves_valid_existing_plan_on_ai_failure(self):
        old_shots = [{
            "index": index, "title": f"Shot {index + 1}", "description": "A saved shot.",
            "camera_movement": "static", "shot_size": "wide", "duration_seconds": 3,
            "direction": "Hold still.", "status": "captured",
        } for index in range(4)]
        doc = {
            "id": "p", "user_id": "u", "title": "Home tour", "shoot_type": "real_estate",
            "purpose": "Show the home", "mood": "luxury", "style": "luxury", "platform": "instagram_reel",
            "duration_seconds": 12, "audience": "", "storyboard": old_shots,
            "storyboard_ai_generated": True, "script": "Saved concept.",
        }

        async def fake_project(*_args):
            return doc.copy()

        async def unavailable_ai(*_args, **_kwargs):
            raise RuntimeError("Gemini is temporarily unavailable")

        with patch.object(server, "fetch_project", fake_project), \
             patch.object(server, "chat_once", unavailable_ai), \
             patch.object(server, "save_project") as save_doc:
            result = asyncio.run(server.generate_storyboard("p", user={"id": "u"}))

        self.assertTrue(result["preserved_existing"])
        self.assertEqual(result["storyboard"], old_shots)
        self.assertEqual(result["script"], "Saved concept.")
        save_doc.assert_not_called()

    def test_short_ai_storyboard_is_retried_before_fallback(self):
        doc = {
            "id": "p", "user_id": "u", "title": "Office tour", "shoot_type": "business",
            "purpose": "A welcoming office tour", "mood": "Cinematic", "style": "cinematic",
            "platform": "instagram_reel", "duration_seconds": 12, "audience": "general",
            "storyboard": None,
        }
        shot = lambda index: {
            "title": f"Office moment {index + 1}", "description": "Show a real part of this office.",
            "purpose": "detail", "shotType": "wide", "duration": 3,
            "cameraMovement": "static", "instruction": "Frame the space and hold steady.",
        }
        short_response = json.dumps({"concept": "A welcoming office story.", "shots": [shot(i) for i in range(3)]})
        complete_response = json.dumps({"concept": "A welcoming office story.", "shots": [shot(i) for i in range(4)]})

        async def fake_project(*_args):
            return doc.copy()

        async def save_doc(value, _user_id):
            doc.update(value)

        ai = AsyncMock(side_effect=[short_response, complete_response])
        with patch.object(server, "fetch_project", fake_project), \
             patch.object(server, "chat_once", ai), \
             patch.object(server, "save_project", save_doc):
            result = asyncio.run(server.generate_storyboard("p", user={"id": "u"}))

        self.assertTrue(result["ai_generated"])
        self.assertEqual(len(result["storyboard"]), 4)
        self.assertEqual(ai.await_count, 2)
        self.assertIn("NO SCAN", ai.await_args_list[0].args[1])
        self.assertIn("last draft had only 3 shots", ai.await_args.args[1])

    def test_storyboard_endpoint_persists_fallback_when_ai_is_unavailable(self):
        doc = {
            "id": "p", "user_id": "u", "title": "Home tour", "shoot_type": "real_estate",
            "purpose": "", "mood": "luxury", "style": "luxury", "platform": "instagram_reel",
            "duration_seconds": 45, "audience": "", "storyboard": None,
        }

        async def fake_project(*_args):
            return doc.copy()

        async def unavailable_ai(*_args, **_kwargs):
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
            self.assertIsNotNone(server.get_supabase().storage)
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
