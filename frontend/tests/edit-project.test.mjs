import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEditProject } from '../src/editor/project.ts';

test('serializes ordered trims, captions, music, and narration into one edit document', () => {
  const doc = toEditProject({
    id: 'project-1',
    clips: [
      { shot_index: 1, duration_seconds: 8, video_storage_path: 'u/p/second.mp4' },
      { shot_index: 0, duration_seconds: 6, video_storage_path: 'u/p/first.mp4' },
    ],
    storyboard: [{ on_screen_text: 'Opening' }, { on_screen_text: 'Detail' }],
    soundtrack: { storage_path: 'u/p/music.m4a' }, voiceover: { storage_path: 'u/p/voice.m4a' },
  }, {
    clip_order: [0, 1], clip_edits: [
      { shot_index: 0, included: true, trim_start_seconds: 1, trim_end_seconds: 5, playback_rate: 2, filter_preset: 'film' },
      { shot_index: 1, included: false },
    ], captions_enabled: true,
    caption_edits: [{ shot_index: 0, start_seconds: 0, end_seconds: 2, position_x: 50, position_y: 80, size: 'medium', font: 'inter' }],
    title_text: 'A story', title_font: 'playfair', title_animation: 'fade', title_position: 'top',
    resolution: '1080p', aspect_ratio: '9:16', fps: 30, music_volume: 20, voiceover_volume: 100, original_volume: 70,
  });
  const main = doc.tracks.find((track) => track.kind === 'main').items;
  assert.equal(main.length, 1);
  assert.deepEqual([main[0].start, main[0].inPoint, main[0].outPoint, main[0].duration], [0, 1, 5, 2]);
  assert.equal(doc.tracks.find((track) => track.kind === 'text').items.length, 2);
  assert.deepEqual(doc.tracks.find((track) => track.kind === 'audio').items.map((item) => item.role), ['music', 'voiceover']);
  assert.equal(doc.resolution, '1080p');
});
