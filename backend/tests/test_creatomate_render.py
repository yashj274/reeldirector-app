import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class CreatomateRenderTests(unittest.TestCase):
    def test_render_request_includes_edits_captions_and_both_audio_tracks(self):
        async def run():
            response = [{"id": "render_12345678", "status": "planned"}]
            body = server.ExportIn(
                resolution="1080p", fps=30, title_text="A launch",
                title_font="playfair", title_animation="slide-up",
                captions_enabled=True, original_volume=0.7,
                music_volume=0.2, voiceover_volume=0.9,
            )
            clip = {"shot_index": 0, "duration_seconds": 8, "video_storage_path": "u/p/clip.mp4"}
            edits = {0: {"trim_start_seconds": 1, "trim_end_seconds": 7,
                         "filter_preset": "film", "brightness": 0.1, "playback_rate": 1.5}}
            captions = {0: {"start_seconds": 0.5, "end_seconds": 3, "position_x": 50,
                            "position_y": 80, "size": "medium", "font": "inter"}}
            with patch.object(server, "CREATOMATE_API_KEY", "test-key"), \
                 patch.object(server, "signed_media_url", new=AsyncMock(side_effect=lambda path, *_: "https://signed.test/" + path)), \
                 patch.object(server, "provider_json", new=AsyncMock(return_value=response)) as submit, \
                 patch.object(server, "save_project", new=AsyncMock()):
                result = await server.start_creatomate_render(
                    "p", {"storyboard": [{"on_screen_text": "Opening"}]}, [clip], body,
                    "u", "u/p/", 1080, 1920, "cinematic", "u/p/music.m4a",
                    {"title": "Music"}, edits, {0: [4]}, captions, "u/p/voice.m4a",
                )
            source = submit.await_args.args[3]
            elements = source["elements"]
            video = next(item for item in elements if item["type"] == "video")
            self.assertEqual((video["trim_start"], video["trim_duration"], video["speed"], video["volume"]), (1, 3, "150.0%", "70.0%"))
            self.assertEqual(sum(item["type"] == "video" for item in elements), 2)
            self.assertTrue(any(item["name"].startswith("Caption-") for item in elements))
            self.assertTrue(any(item["name"] == "Main-Title" and item["animations"][0]["type"] == "text-slide" for item in elements))
            self.assertEqual({item["name"] for item in elements if item["type"] == "audio"}, {"Soundtrack", "Voiceover"})
            self.assertEqual(result["provider"], "creatomate")

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
