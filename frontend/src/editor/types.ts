// Versioned, portable edit description persisted alongside the editor settings.
// All times are in seconds. All positions/sizes are percentages (0–100) of the video frame.

export type TrackKind = 'main' | 'overlay' | 'text' | 'audio';
export type Aspect = '9:16' | '1:1' | '4:5' | '16:9';
export type Resolution = '720p' | '1080p';

export interface EditProject {
  version: 1;
  id: string;
  aspect: Aspect;
  fps: 24 | 30 | 60;
  resolution: Resolution;
  tracks: Track[]; // array order = z-order, first is bottom
}

export interface Track {
  id: string;
  kind: TrackKind;
  muted?: boolean;
  items: TrackItem[];
}

export type TrackItem = VideoItem | ImageItem | TextItem | AudioItem;
export type ItemType = TrackItem['type'];

interface BaseItem {
  id: string;
  start: number; // position on the timeline
  duration: number; // length on the timeline (already accounts for speed)
  signed_url?: string; // temporary preview URL; stripped before persistence
}

export interface VideoItem extends BaseItem {
  type: 'video';
  src: string; // Supabase storage path
  sourceDuration: number; // full length of the source file
  inPoint: number; // trim start inside the source
  outPoint: number; // trim end inside the source
  speed: number; // 0.25 – 4
  volume: number; // 0 – 1
  filter?: FilterRef;
  transitionIn?: Transition;
  frame?: Frame; // only for B-roll / picture-in-picture
}

export interface ImageItem extends BaseItem {
  type: 'image';
  src: string;
  filter?: FilterRef;
  transitionIn?: Transition;
  frame?: Frame;
  kenBurns?: boolean;
}

export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;

export interface TextItem extends BaseItem {
  type: 'text';
  text: string;
  fontId: string; // id from fonts.ts
  weight: FontWeight;
  italic?: boolean;
  size: number; // % of the video's shorter edge, e.g. 6
  color: string; // hex
  background?: { color: string; radius: number; padding: number };
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number };
  align: 'left' | 'center' | 'right';
  x: number; // centre, %
  y: number; // centre, %
  maxWidth: number; // %
  animationIn?: TextAnimation;
  animationOut?: TextAnimation;
}

export interface AudioItem extends BaseItem {
  type: 'audio';
  src: string;
  sourceDuration: number;
  inPoint: number;
  volume: number; // 0 – 1
  fadeIn?: number;
  fadeOut?: number;
  role: 'music' | 'voiceover' | 'sfx';
}

export interface Frame {
  x: number; // centre, %
  y: number; // centre, %
  width: number; // %
  height: number; // %
  radius?: number; // px at 1080 wide
}

export interface FilterRef {
  presetId: string;
  intensity: number; // 0 – 1
}

export type TransitionType = 'fade' | 'slide-left' | 'slide-up' | 'zoom' | 'wipe';
export type Transition = { type: 'none' } | { type: TransitionType; duration: number };

export type TextAnimation = 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter' | 'word-by-word';

export const ASPECT_SIZES: Record<Aspect, Record<Resolution, { width: number; height: number }>> = {
  '9:16': { '720p': { width: 720, height: 1280 }, '1080p': { width: 1080, height: 1920 } },
  '1:1': { '720p': { width: 720, height: 720 }, '1080p': { width: 1080, height: 1080 } },
  '4:5': { '720p': { width: 720, height: 900 }, '1080p': { width: 1080, height: 1350 } },
  '16:9': { '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 } },
};
