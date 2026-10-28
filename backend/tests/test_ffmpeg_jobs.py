"""Regression checks for real FFmpeg output and durable worker behavior."""
import asyncio
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import render_jobs
import render_filters
import render_text
import render_worker
import server


class RenderJobTests(unittest.TestCase):
    def test_export_filter_values_match_the_web_preview(self):
        editor = Path(__file__).resolve().parents[2] / 'frontend/app/project/[id]/export.tsx'
        if not editor.exists():
            self.skipTest('Frontend source is not included in this backend deployment')
        css = editor.read_text().split('const FILTERS: Record<string, string> = {', 1)[1].split('};', 1)[0]
        self.assertEqual(dict(re.findall(r"([\w]+):\s*'([^']*)'", css)), render_filters.CSS_FILTERS)

    def test_export_returns_queued_job_without_calling_ai_or_rendering(self):
        project = {'id': 'p', 'user_id': 'u', 'title': 'Test', 'style': 'original',
                   'clips': [{'shot_index': 0, 'video_storage_path': 'u/p/clip.mp4', 'duration_seconds': 2}]}
        async def run():
            with patch.object(server, 'fetch_project', AsyncMock(return_value=project)), \
                 patch.object(server, 'get_supabase', return_value=Mock()), \
                 patch.object(render_jobs, 'enqueue', AsyncMock(return_value={'job_id': 'j', 'status': 'QUEUED'})) as enqueue, \
                 patch.object(server, 'chat_once', AsyncMock(side_effect=AssertionError('Export must not wait for AI'))), \
                 patch.object(server, '_normalize_video_clip', side_effect=AssertionError('Render must run in worker')):
                result = await server.export_project('p', server.ExportIn(async_export=True), user={'id': 'u'})
                self.assertEqual(result['status'], 'QUEUED')
                self.assertEqual(enqueue.await_args.args[2]['render_provider'], 'ffmpeg')
        asyncio.run(run())

    def test_old_installed_apps_receive_a_finished_export(self):
        async def run():
            result = {'url': 'https://example.test/final.mp4', 'duration_seconds': 3}
            with patch.object(server, '_export_project', AsyncMock(return_value={'provider': 'ffmpeg', 'job_id': 'j'})), \
                 patch.object(server, 'render_job_status', AsyncMock(return_value={'status': 'COMPLETED', 'export': result})):
                response = await server.export_project('p', server.ExportIn(), user={'id': 'u'})
                self.assertEqual(response.status_code, 200)
                self.assertIn(b'final.mp4', response.body)
        asyncio.run(run())

    def test_broll_rejects_foreign_paths_and_nonfinite_frame_values(self):
        item = {'type': 'image', 'src': 'u/p/overlay.jpg', 'start': 0, 'duration': 1}
        doc = {'edit_json': {'tracks': [{'kind': 'overlay', 'items': [item]}]}}
        server.validate_broll(doc, 'u/p/')
        for path in ('another-user/p/image.jpg', 'u/p/../image.jpg', 'u/p/%2e%2e/image.jpg'):
            with self.assertRaises(server.HTTPException):
                server.validate_broll({'edit_json': {'tracks': [{'kind': 'overlay', 'items': [{**item, 'src': path}]}]}}, 'u/p/')
        item['frame'] = {'x': float('nan')}
        with self.assertRaises(server.HTTPException):
            server.validate_broll(doc, 'u/p/')

    def test_worker_retries_then_stops_and_commits_success_atomically(self):
        async def run():
            client = Mock()
            query = Mock()
            query.eq.return_value = query
            query.execute = AsyncMock(return_value=SimpleNamespace(data=[{'id': 'j'}]))
            client.table.return_value.update.return_value = query
            client.rpc.return_value.execute = AsyncMock(return_value=SimpleNamespace(data=True))
            client.storage.from_.return_value.remove = AsyncMock()
            job = {'id': 'j', 'worker_id': 'w', 'project_id': 'p', 'user_id': 'u', 'attempts': 1,
                   'payload': {'options': {}, 'project': {}}}
            with patch.object(server, 'get_supabase', return_value=client), \
                 patch.object(server, '_export_project', AsyncMock(side_effect=server.HTTPException(502, 'unavailable'))):
                await render_worker.process(job)
                self.assertEqual(client.table.return_value.update.call_args.args[0]['status'], 'queued')
                job['attempts'] = 3
                await render_worker.process(job)
                self.assertEqual(client.table.return_value.update.call_args.args[0]['status'], 'failed')
            result = {'storage_path': 'u/p/exports/final.mp4'}
            with patch.object(server, 'get_supabase', return_value=client), \
                 patch.object(server, '_export_project', AsyncMock(return_value=result)):
                await render_worker.process(job)
                self.assertEqual(client.rpc.call_args.args[0], 'finish_render_job')
                self.assertEqual(client.rpc.call_args.args[1]['p_result'], result)
        asyncio.run(run())

    def test_fonts_are_the_same_files_in_editor_and_renderer(self):
        source = Path(__file__).resolve().parents[2] / 'frontend/assets/fonts/editor'
        for font_id in render_text.FONTS:
            file = server._title_font_path(font_id)
            self.assertTrue(file.is_file(), font_id)
            if source.exists():
                self.assertEqual(file.read_bytes(), (source / file.name).read_bytes(), font_id)


class RealVideoTests(unittest.TestCase):
    def test_slow_motion_duration_and_real_broll_title_audio_composition(self):
        ffmpeg = server._ffmpeg_executable()
        def ff(*args):
            result = subprocess.run([ffmpeg, '-y', '-threads', '1', *args], capture_output=True)
            if result.returncode:
                self.fail(result.stderr.decode(errors='replace')[-3500:])
        with tempfile.TemporaryDirectory(prefix='reel-engine-test-') as folder:
            temp = Path(folder)
            source, music, voice, image = (temp / name for name in ('source.mp4', 'music.m4a', 'voice.m4a', 'broll.png'))
            ff('-f', 'lavfi', '-i', 'color=c=blue:s=180x320:r=24:d=1', '-f', 'lavfi', '-i',
               'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(source))
            ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-c:a', 'aac', str(music))
            ff('-f', 'lavfi', '-i', 'sine=frequency=660:duration=0.7', '-c:a', 'aac', str(voice))
            ff('-f', 'lavfi', '-i', 'color=c=red:s=80x80', '-frames:v', '1', str(image))
            normalized = temp / 'normalized.mp4'
            server._normalize_video_clip(source, normalized, 180, 320, 24, 0, 1, playback_rate=.5)
            info = subprocess.run([ffmpeg, '-i', str(normalized)], capture_output=True, text=True).stderr
            self.assertIn('00:00:02.', info, info)
            for preset in ('warm', 'cool', 'mono', 'vivid', 'vintage', 'soft', 'film'):
                graded = temp / f'{preset}.mp4'
                try:
                    server._normalize_video_clip(source, graded, 180, 320, 24, 0, 1,
                                                 filter_preset=preset, brightness=.1)
                except subprocess.CalledProcessError as error:
                    self.fail(error.stderr.decode(errors='replace')[-2000:])
                ff('-i', str(graded), '-f', 'null', '-')
            concat = temp / 'clips.txt'
            concat.write_text("file 'normalized.mp4'\nfile 'normalized.mp4'\n")
            for animation in ('none', 'fade', 'pop', 'slide-up', 'typewriter', 'word-by-word'):
                output = temp / f'{animation}.mp4'
                try:
                    server._run_video_render(concat, output, 180, 320, music, 24, 'original',
                        'A real story', 'playfair', 'top', 'white', 'medium', .25, .8, voice, 1,
                        animation, [{'file': image, 'start': 1, 'duration': 1,
                                     'frame': {'x': 50, 'y': 65, 'width': 40, 'height': 25, 'radius': 18}}])
                except subprocess.CalledProcessError as error:
                    self.fail(error.stderr.decode(errors='replace')[-5000:])
                probe = subprocess.run([ffmpeg, '-i', str(output)], capture_output=True, text=True).stderr
                self.assertIn('00:00:04.', probe, probe)
                self.assertIn('Audio: aac', probe)
                # Decode every frame: a nonempty file alone does not prove a playable reel.
                ff('-i', str(output), '-f', 'null', '-')
            for second, expected_red in ((.5, False), (1.5, True), (2.5, False)):
                frame = subprocess.run([ffmpeg, '-v', 'error', '-ss', str(second), '-i', str(output),
                    '-frames:v', '1', '-vf', 'crop=1:1:90:208,format=rgb24', '-f', 'rawvideo', '-'], capture_output=True)
                self.assertEqual(frame.returncode, 0, frame.stderr)
                self.assertEqual(len(frame.stdout), 3)
                red, _, blue = frame.stdout
                self.assertEqual(red > blue, expected_red)
