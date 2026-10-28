import type { EditProject, Track, VideoItem, TextItem, AudioItem, Aspect } from './types';

const track = (id: string, kind: Track['kind']): Track => ({ id, kind, items: [] });
const fontId = (font: string) => ({ sans: 'inter', bold: 'montserrat', condensed: 'bebas', serif: 'playfair', serif_bold: 'fraunces', mono: 'space-grotesk' }[font] || font || 'inter');

/** Build the versioned edit document from the app's existing saved editor settings. */
export function toEditProject(project: any, settings: Record<string, any>): EditProject {
  const tracks = [track('main', 'main'), track('broll', 'overlay'), track('titles', 'text'), track('audio', 'audio')];
  const [main, , titles, audio] = tracks;
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  const edits = new Map<number, any>((settings.clip_edits || []).map((edit: any) => [Number(edit.shot_index), edit]));
  const order = new Map<number, number>((settings.clip_order || []).map((shot: number, index: number) => [Number(shot), index]));
  const ordered = [...clips].sort((a, b) => (order.get(Number(a.shot_index)) ?? Number.MAX_SAFE_INTEGER) - (order.get(Number(b.shot_index)) ?? Number.MAX_SAFE_INTEGER));
  const savedOverlay = project?.edit_json?.tracks?.find((value: any) => value.kind === 'overlay');
  if (Array.isArray(savedOverlay?.items)) tracks[1].items = savedOverlay.items;
  let cursor = 0;
  for (const [index, clip] of ordered.entries()) {
    const shot = Number.isInteger(Number(clip.shot_index)) ? Number(clip.shot_index) : index;
    const edit: any = edits.get(shot) || {};
    if (edit.included === false || !clip.video_storage_path) continue;
    const sourceDuration = Math.max(0.2, Number(clip.duration_seconds) || 5);
    const inPoint = Math.max(0, Math.min(sourceDuration, Number(edit.trim_start_seconds) || 0));
    const outPoint = Math.max(inPoint + 0.2, Math.min(sourceDuration, Number(edit.trim_end_seconds) || sourceDuration));
    const speed = Number(edit.playback_rate) || 1;
    const duration = (outPoint - inPoint) / speed;
    const item: VideoItem = {
      id: `shot-${shot}`, type: 'video', src: clip.video_storage_path, sourceDuration,
      start: cursor, duration, inPoint, outPoint, speed,
      volume: Math.max(0, Math.min(1, Number(settings.original_volume ?? 80) / 100)),
      filter: edit.filter_preset && edit.filter_preset !== 'original' ? { presetId: edit.filter_preset, intensity: 1 } : undefined,
    };
    main.items.push(item);
    const text = String(project.storyboard?.[shot]?.on_screen_text || '').trim();
    const caption = (settings.caption_edits || []).find((value: any) => Number(value.shot_index) === shot);
    if (settings.captions_enabled && text && caption) {
      const captionItem: TextItem = {
        id: `caption-${shot}`, type: 'text', text, start: cursor + Math.max(0, Number(caption.start_seconds) || 0),
        duration: Math.max(0.15, Number(caption.end_seconds || duration) - Number(caption.start_seconds || 0)),
        fontId: fontId(caption.font), weight: 700, size: caption.size === 'large' ? 6.2 : caption.size === 'small' ? 3.4 : 4.6,
        color: '#FFFFFF', align: 'center', x: Number(caption.position_x ?? 50), y: Number(caption.position_y ?? 84), maxWidth: 92,
        animationIn: 'fade',
      };
      titles.items.push(captionItem);
    }
    cursor += duration;
  }
  if (settings.title_text) {
    const position = settings.title_position === 'top' ? 15 : settings.title_position === 'center' ? 50 : 84;
    titles.items.push({
      id: 'main-title', type: 'text', text: String(settings.title_text).slice(0, 80), start: 0, duration: Math.min(3.5, cursor || 3.5),
      fontId: fontId(settings.title_font), weight: 700, size: settings.title_size === 'large' ? 7.4 : settings.title_size === 'small' ? 4.2 : 5.8,
      color: ({ white: '#FFFFFF', gold: '#F5C869', pink: '#E0115F', black: '#101114' } as Record<string, string>)[settings.title_color] || '#FFFFFF',
      align: 'center', x: 50, y: position, maxWidth: 90,
      animationIn: settings.title_animation || 'fade',
    });
  }
  for (const [role, value, volume] of [
    ['music', project.soundtrack, settings.music_volume], ['voiceover', project.voiceover, settings.voiceover_volume],
  ] as const) {
    if (!value?.storage_path) continue;
    const item: AudioItem = {
      id: role, type: 'audio', src: value.storage_path, sourceDuration: Number(value.duration_seconds) || cursor,
      start: 0, duration: cursor, inPoint: 0, volume: Math.max(0, Math.min(1, Number(volume ?? 0) / 100)), role,
    };
    audio.items.push(item);
  }
  const aspect = (['9:16', '1:1', '4:5', '16:9'].includes(settings.aspect_ratio) ? settings.aspect_ratio : '9:16') as Aspect;
  const fps = [24, 30, 60].includes(Number(settings.fps)) ? Number(settings.fps) as 24 | 30 | 60 : 30;
  return { version: 1, id: String(project.id), aspect, fps, resolution: settings.resolution === '1080p' ? '1080p' : '720p', tracks };
}
