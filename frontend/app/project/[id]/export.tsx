import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import {
  ActivityIndicator, Alert, Animated, Easing, Modal, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useFonts } from 'expo-font';

import { api } from '@/src/api';
import { isClipProgress, shouldAdvanceOnEndEvent } from '@/src/reelPlayback';
import { syncClipEndsToBeats } from '@/src/beatSync';
import { clipWindow, locateTimelinePosition, splitTimelineRange } from '@/src/timeline';
import { theme } from '@/src/theme';
import { EDITOR_FONT_ASSETS } from '@/src/editor/fontAssets';
import { expoFontFamily } from '@/src/editor/fonts';
import { TEXT_STYLES, getTextStyle } from '@/src/editor/textStyles';
import { textSizePixels } from '@/src/editor/textScale';

type ClipEdit = {
  shot_index: number;
  included: boolean;
  trim_start_seconds: number;
  trim_end_seconds: number;
  filter_preset: string;
  brightness: number;
  playback_rate: number;
};

type CaptionEdit = {
  shot_index: number;
  start_seconds: number;
  end_seconds: number;
  position_x: number;
  position_y: number;
  size: string;
  font: string;
};

type EditorSettings = {
  aspect_ratio: string;
  fit_mode: string;
  resolution: string;
  fps: number;
  editing_style: string;
  pacing: 'relaxed' | 'balanced' | 'fast';
  clip_order: number[];
  clip_edits: ClipEdit[];
  clip_splits: Record<number, number[]>;
  title_text: string;
  title_font: string;
  title_style_id: string;
  title_animation: string;
  title_position: string;
  title_color: string;
  title_size: string;
  music_volume: number;
  voiceover_volume: number;
  original_volume: number;
  captions_enabled: boolean;
  caption_edits: CaptionEdit[];
  render_provider: 'creatomate' | 'ffmpeg';
};

type ToolName = 'Audio' | 'Text' | 'Voice' | 'Captions' | 'Overlay' | 'Filter' | 'Export settings';

const LOOKS = [
  { id: 'original', label: 'Original' }, { id: 'cinematic', label: 'Cinematic' },
  { id: 'warm', label: 'Warm' }, { id: 'cool', label: 'Cool' }, { id: 'mono', label: 'B&W' },
  { id: 'vivid', label: 'Vivid' }, { id: 'vintage', label: 'Vintage' },
  { id: 'soft', label: 'Soft' }, { id: 'luxury', label: 'Luxury' },
  { id: 'editorial', label: 'Editorial' }, { id: 'action', label: 'Action' },
  { id: 'fast_pace', label: 'Fast' }, { id: 'minimal', label: 'Minimal' },
];

const CLIP_FILTERS = [
  { id: 'original', label: 'Original' }, { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' }, { id: 'mono', label: 'B&W' },
  { id: 'vivid', label: 'Vivid' }, { id: 'vintage', label: 'Vintage' },
  { id: 'soft', label: 'Soft' }, { id: 'film', label: 'Film' },
];

const DEFAULT_SETTINGS: EditorSettings = {
  aspect_ratio: '9:16', fit_mode: 'fill', resolution: '720p', fps: 30, editing_style: 'cinematic', pacing: 'balanced',
  clip_order: [], clip_edits: [], clip_splits: {}, title_text: '', title_font: 'inter', title_style_id: 'clean', title_animation: 'fade',
  title_position: 'bottom', title_color: 'white', title_size: 'medium',
  music_volume: 25, voiceover_volume: 100, original_volume: 80, captions_enabled: false, caption_edits: [], render_provider: 'ffmpeg',
};

const CAPTION_FONTS = [
  ['inter', 'Clean'], ['montserrat', 'Modern'], ['space-grotesk', 'Tech'],
  ['bebas', 'Title'], ['anton', 'Bold'], ['archivo-black', 'Heavy'],
  ['fraunces', 'Soft serif'], ['playfair', 'Elegant'], ['dm-serif', 'Editorial'],
  ['caveat', 'Handwritten'], ['marker', 'Marker'],
];

const FILTERS: Record<string, string> = {
  warm: 'sepia(0.16) saturate(1.12)', cool: 'hue-rotate(9deg) saturate(1.06)',
  mono: 'grayscale(1) contrast(1.04)', vivid: 'saturate(1.22) contrast(1.08)',
  vintage: 'sepia(0.24) saturate(0.8) contrast(0.92)', soft: 'saturate(0.92) contrast(0.92)',
  film: 'sepia(0.12) saturate(0.88) contrast(0.96)',
  cinematic: 'contrast(1.08) saturate(0.9)', luxury: 'contrast(1.08) saturate(0.94)',
  editorial: 'contrast(1.06) saturate(0.86)', action: 'contrast(1.12) saturate(1.12)',
  fast_pace: 'contrast(1.08) saturate(1.12)', minimal: 'saturate(0.85)',
};

const TITLE_COLORS: Record<string, string> = { white: '#fff', gold: '#F5C869', pink: '#E0115F', black: '#101114' };

function shotIndex(clip: any, fallback: number) {
  const value = Number(clip?.shot_index);
  return Number.isInteger(value) ? value : fallback;
}

function fontFamily(font: string, weight: 400 | 500 | 600 | 700 | 800 | 900 = 700) {
  return expoFontFamily(font, weight);
}

function makeSettings(project: any): EditorSettings {
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  const saved = project?.edit_settings || {};
  const shotIds = clips.map((clip: any, index: number) => shotIndex(clip, index));
  const savedOrder = Array.isArray(saved.clip_order) ? saved.clip_order : [];
  const clipOrder = [
    ...savedOrder.filter((id: number) => shotIds.includes(id)),
    ...shotIds.filter((id: number) => !savedOrder.includes(id)),
  ];
  const clipEdits = clips.map((clip: any, index: number) => {
    const id = shotIndex(clip, index);
    const duration = Math.max(0.5, Number(clip?.duration_seconds) || 5);
    const old = Array.isArray(saved.clip_edits)
      ? saved.clip_edits.find((edit: any) => edit.shot_index === id) : null;
    const end = Math.min(duration, Math.max(0.25, Number(old?.trim_end_seconds) || duration));
    return {
      shot_index: id,
      included: old?.included !== false,
      trim_start_seconds: Math.max(0, Math.min(end - 0.25, Number(old?.trim_start_seconds) || 0)),
      trim_end_seconds: end,
      filter_preset: CLIP_FILTERS.some((filter) => filter.id === old?.filter_preset) ? old.filter_preset : 'original',
      brightness: Math.max(-0.5, Math.min(0.5, Number(old?.brightness ?? clip?.brightness) || 0)),
      playback_rate: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(Number(old?.playback_rate)) ? Number(old.playback_rate) : 1,
    };
  });
  const captionEdits = clips.map((clip: any, index: number) => {
    const id = shotIndex(clip, index);
    const clipEdit = clipEdits.find((edit: ClipEdit) => edit.shot_index === id)!;
    const clipWindow = Math.max(0.25, clipEdit.trim_end_seconds - clipEdit.trim_start_seconds) / clipEdit.playback_rate;
    const old = Array.isArray(saved.caption_edits)
      ? saved.caption_edits.find((edit: any) => edit.shot_index === id) : null;
    const oldStart = Number(old?.start_seconds);
    const oldEnd = Number(old?.end_seconds);
    const oldX = Number(old?.position_x);
    const oldY = Number(old?.position_y);
    const start = Math.max(0, Math.min(clipWindow - 0.15, Number.isFinite(oldStart) ? oldStart : 0));
    const end = Math.max(start + 0.15, Math.min(clipWindow, Number.isFinite(oldEnd) && oldEnd > 0 ? oldEnd : clipWindow));
    return {
      shot_index: id,
      start_seconds: start,
      end_seconds: end,
      position_x: Math.max(0, Math.min(100, Number.isFinite(oldX) ? oldX : 50)),
      position_y: Math.max(0, Math.min(100, Number.isFinite(oldY) ? oldY : 84)),
      size: ['small', 'medium', 'large'].includes(old?.size) ? old.size : 'medium',
      font: CAPTION_FONTS.some(([font]) => font === old?.font) ? old.font : 'sans',
    };
  });
  const clipSplits: Record<number, number[]> = {};
  for (const edit of clipEdits) {
    const rawPoints = saved.clip_splits?.[edit.shot_index] || saved.clip_splits?.[String(edit.shot_index)] || [];
    if (Array.isArray(rawPoints)) {
      const points = [...new Set(rawPoints.map(Number).filter((point) => Number.isFinite(point)
        && point > edit.trim_start_seconds + 0.25 && point < edit.trim_end_seconds - 0.25))].sort((a, b) => a - b);
      if (points.length) clipSplits[edit.shot_index] = points;
    }
  }
  const musicVolume = Number(saved.music_volume);
  const voiceoverVolume = Number(saved.voiceover_volume);
  const originalVolume = Number(saved.original_volume);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    render_provider: saved.render_provider === 'creatomate' ? 'creatomate' : 'ffmpeg',
    title_style_id: saved.title_style_id === 'custom' || TEXT_STYLES.some((style) => style.id === saved.title_style_id) ? saved.title_style_id : 'clean',
    title_animation: ['none', 'fade', 'pop', 'slide-up', 'typewriter', 'word-by-word'].includes(saved.title_animation) ? saved.title_animation : 'fade',
    pacing: ['relaxed', 'balanced', 'fast'].includes(saved.pacing) ? saved.pacing : 'balanced',
    title_font: CAPTION_FONTS.some(([font]) => font === saved.title_font) ? saved.title_font : 'sans',
    music_volume: Number.isFinite(musicVolume) ? (musicVolume <= 1 ? musicVolume * 100 : musicVolume) : DEFAULT_SETTINGS.music_volume,
    voiceover_volume: Number.isFinite(voiceoverVolume) ? (voiceoverVolume <= 1 ? voiceoverVolume * 100 : voiceoverVolume) : DEFAULT_SETTINGS.voiceover_volume,
    original_volume: Number.isFinite(originalVolume) ? (originalVolume <= 1 ? originalVolume * 100 : originalVolume) : DEFAULT_SETTINGS.original_volume,
    captions_enabled: saved.captions_enabled === true,
    caption_edits: captionEdits,
    clip_order: clipOrder,
    clip_edits: clipEdits,
    clip_splits: clipSplits,
  };
}

function clock(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}


export default function Export() {
  const { id, clip: clipParam } = useLocalSearchParams<{ id: string; clip?: string }>();
  const router = useRouter();
  const [fontsLoaded] = useFonts(EDITOR_FONT_ASSETS);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [project, setProject] = useState<any>(null);
  const [selectedShot, setSelectedShot] = useState<number | null>(null);
  const [activePlayerSlot, setActivePlayerSlot] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [sourceDurations, setSourceDurations] = useState<Record<number, number>>({});
  const [playing, setPlaying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [autoEditing, setAutoEditing] = useState(false);
  const [beatSyncing, setBeatSyncing] = useState(false);
  const [renderStage, setRenderStage] = useState('');
  const [renderError, setRenderError] = useState('');
  const [notice, setNotice] = useState('');
  const [tool, setTool] = useState<ToolName | null>(null);
  const [toolError, setToolError] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [captionPositionMode, setCaptionPositionMode] = useState(false);
  const [captionLayout, setCaptionLayout] = useState({ width: 0, height: 0 });
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [addingClip, setAddingClip] = useState(false);
  const [selectedBroll, setSelectedBroll] = useState<string | null>(null);
  const [retakingClip, setRetakingClip] = useState(false);
  const [addClipError, setAddClipError] = useState('');
  const historyBack = useRef<EditorSettings[]>([]);
  const historyForward = useRef<EditorSettings[]>([]);
  const editorScrollRef = useRef<ScrollView | null>(null);
  const desiredTime = useRef(0);
  const desiredShot = useRef<number | null>(null);
  const autoAdvance = useRef(false);
  const playbackFinished = useRef(false);
  const preparedPlayer = useRef<{ player: any; shot: number } | null>(null);
  const loadedPlayerShot = useRef(-1);
  const clipHasPlayed = useRef(false);
  const clipStarted = useRef(false);
  const sourceLoadedShot = useRef(-1);
  const refreshedMediaShots = useRef(new Set<number>());
  const currentActiveShot = useRef(-1);
  const currentActiveUri = useRef<string | null>(null);
  const currentTrimStart = useRef(0);
  const currentClipEnd = useRef(0);
  const advanceRef = useRef<(sourcePlayer?: any) => boolean>(() => false);
  const currentPlayer = useRef<any>(null);
  const activePlayerSlotRef = useRef(0);
  const timelineWidthRef = useRef(0);
  const timelineDurationRef = useRef(0);
  const timelinePositionRef = useRef(0);
  const seekTimelineRef = useRef<(time: number) => void>(() => {});
  const timelineDragOrigin = useRef(0);
  const initialLoadComplete = useRef(false);
  const dirtyRef = useRef(dirty);
  const selectedShotRef = useRef(selectedShot);
  const settingsRef = useRef(settings);
  const autosaveFailedFor = useRef<EditorSettings | null>(null);
  settingsRef.current = settings;
  dirtyRef.current = dirty;
  selectedShotRef.current = selectedShot;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const rot = useRef(new Animated.Value(0)).current;
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    const shot = Number(clipParam);
    if (clipParam !== undefined && Number.isInteger(shot)) {
      selectedShotRef.current = shot;
      setSelectedShot(shot);
    }
  }, [clipParam]);

  useFocusEffect(useCallback(() => {
    if (!id) return undefined;
    let alive = true;
    api.getProject(id).then((loaded) => {
      if (!alive) return;
      const shouldPreviewReel = !initialLoadComplete.current && clipParam === undefined;
      setProject(loaded);
      const next = makeSettings(loaded);
      if (selectedShotRef.current === null) {
        const firstShot = next.clip_order.find((shot) => {
          const clip = (loaded.clips || []).find((item: any, index: number) => shotIndex(item, index) === shot);
          return !!clip?.video_url && editForShot(next, shot).included;
        });
        if (firstShot !== undefined) {
          desiredShot.current = firstShot;
          desiredTime.current = editForShot(next, firstShot).trim_start_seconds;
          if (shouldPreviewReel) autoAdvance.current = true;
          selectedShotRef.current = firstShot;
          setSelectedShot(firstShot);
        }
      }
      setSettings((current) => {
        if (!initialLoadComplete.current || !dirtyRef.current) {
          initialLoadComplete.current = true;
          return next;
        }
        const knownShots = new Set(current.clip_edits.map((edit) => edit.shot_index));
        return {
          ...next, ...current,
          clip_order: [...current.clip_order, ...next.clip_order.filter((shot) => !current.clip_order.includes(shot))],
          clip_edits: [...current.clip_edits, ...next.clip_edits.filter((edit) => !knownShots.has(edit.shot_index))],
          caption_edits: [...current.caption_edits, ...next.caption_edits.filter((edit) => !current.caption_edits.some((saved) => saved.shot_index === edit.shot_index))],
        };
      });
      setRenderError('');
    }).catch((error: any) => { if (alive) setRenderError(error.message || 'Could not load this project.'); });
    return () => { alive = false; };
  }, [id, clipParam]));

  useEffect(() => {
    if (!id || !dirty || saving || rendering || retakingClip || autosaveFailedFor.current === settings) return undefined;
    const timer = setTimeout(async () => {
      const snapshot = settingsRef.current;
      setSaving(true);
      setRenderError('');
      try {
        await api.saveEditSettings(id, snapshot as any);
        autosaveFailedFor.current = null;
        if (settingsRef.current === snapshot) {
          setDirty(false);
          setNotice('Changes saved');
        }
      } catch (error: any) {
        autosaveFailedFor.current = snapshot;
        setRenderError(error.message || 'Could not save your edits. Check your connection and try again.');
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [dirty, id, rendering, retakingClip, saving, settings]);

  useEffect(() => {
    if (!rendering) return;
    const animation = Animated.loop(Animated.timing(rot, {
      toValue: 1, duration: 2200, useNativeDriver: true, easing: Easing.linear,
    }));
    animation.start();
    return () => animation.stop();
  }, [rendering, rot]);

  const clips = useMemo(() => Array.isArray(project?.clips) ? project.clips : [], [project?.clips]);
  const orderedClips = useMemo(() => {
    const ordered: any[] = [];
    const remaining = [...clips];
    for (const shot of settings.clip_order) {
      const index = remaining.findIndex((clip: any, i: number) => shotIndex(clip, i) === shot);
      if (index >= 0) ordered.push(remaining.splice(index, 1)[0]);
    }
    return [...ordered, ...remaining];
  }, [clips, settings.clip_order]);
  const orderedSegments = useMemo(() => orderedClips.flatMap((clip: any, index: number) => {
    const shot = shotIndex(clip, index);
    const edit = editForShot(settings, shot);
    if (!edit.included || !clip.video_url) return [];
    const window = clipWindow(clip, shot, edit, sourceDurations);
    return splitTimelineRange(window.start, window.end, settings.clip_splits[shot] || []).map(({ start, end }, part) => ({
      id: `${shot}:${part}:${start.toFixed(3)}`, clip, shot,
      start, end, part,
    }));
  }), [orderedClips, settings, sourceDurations]);
  const activeClip = orderedClips.find((clip: any, index: number) => shotIndex(clip, index) === selectedShot)
    || orderedClips.find((clip: any, index: number) => editForShot(settings, shotIndex(clip, index)).included)
    || orderedClips[0];
  const activeShot = activeClip ? shotIndex(activeClip, orderedClips.indexOf(activeClip)) : -1;
  const activeEdit = activeShot >= 0 ? editForShot(settings, activeShot) : null;
  const activeStoryboard = activeShot >= 0 ? project?.storyboard?.[activeShot] : null;
  const openingClip = orderedClips.find((clip: any, index: number) => editForShot(settings, shotIndex(clip, index)).included);
  const openingShot = openingClip ? shotIndex(openingClip, orderedClips.indexOf(openingClip)) : -1;
  const activeVideoUri = activeClip?.video_url || null;
  const activeSourceDuration = Number(activeClip?.duration_seconds) || 0;
  const activeWindow = activeClip && activeEdit
    ? clipWindow(activeClip, activeShot, activeEdit, sourceDurations)
    : { start: 0, end: activeSourceDuration || playerDuration, duration: activeSourceDuration || playerDuration };
  const showTitleOverlay = !!settings.title_text && activeShot === openingShot
    && (currentTime - activeWindow.start) / (activeEdit?.playback_rate || 1) < 3.5;
  const activeSegmentIndex = orderedSegments.findIndex((segment: any) => segment.shot === activeShot
    && currentTime >= segment.start - 0.15 && currentTime < segment.end - 0.001);
  const activeSegment = orderedSegments[activeSegmentIndex] || orderedSegments.find((segment: any) => segment.shot === activeShot);
  const activeClipEnd = activeSegment?.end ?? activeWindow.end;
  const activeTrimStart = activeSegment?.start ?? activeWindow.start;
  const captionText = activeStoryboard?.on_screen_text || '';
  const activeCaption = settings.caption_edits.find((edit) => edit.shot_index === activeShot)
    || { shot_index: activeShot, start_seconds: 0, end_seconds: Math.max(0.25, activeWindow.duration / (activeEdit?.playback_rate || 1)), position_x: 50, position_y: 84, size: 'medium', font: 'sans' };
  const captionLocalTime = Math.max(0, currentTime - activeWindow.start) / (activeEdit?.playback_rate || 1);
  const captionIsInTime = captionLocalTime >= activeCaption.start_seconds && captionLocalTime <= activeCaption.end_seconds;
  const captionValuesRef = useRef(activeCaption);
  captionValuesRef.current = activeCaption;
  const activeFilter = activeEdit?.filter_preset || 'original';
  const brollItems: any[] = project?.edit_json?.tracks?.find((track: any) => track.kind === 'overlay')?.items || [];
  const nextSegment = activeSegmentIndex >= 0 ? orderedSegments[activeSegmentIndex + 1] : undefined;
  const nextIncludedClip = nextSegment?.clip || null;
  const nextIncludedShot = nextSegment?.shot ?? null;
  const nextVideoUri = nextIncludedShot !== activeShot ? nextIncludedClip?.video_url || null : null;
  const segmentDuration = (segment: any) => (segment.end - segment.start) / editForShot(settings, segment.shot).playback_rate;
  const fullTimelineDuration = orderedSegments.reduce((total: number, segment: any) => total + segmentDuration(segment), 0);
  const timelinePosition = orderedSegments.slice(0, Math.max(0, activeSegmentIndex)).reduce((total: number, segment: any) => total + segmentDuration(segment), 0)
    + (activeSegment && activeEdit
      ? Math.min(segmentDuration(activeSegment), Math.max(0, currentTime - activeTrimStart) / activeEdit.playback_rate)
      : 0);
  const activeBroll = brollItems.find((item) => timelinePosition >= item.start && timelinePosition < item.start + item.duration);
  currentActiveShot.current = activeShot;
  currentActiveUri.current = activeVideoUri;
  currentTrimStart.current = activeTrimStart;
  currentClipEnd.current = activeClipEnd;
  timelineWidthRef.current = timelineWidth;
  timelineDurationRef.current = fullTimelineDuration;
  timelinePositionRef.current = timelinePosition;
  const playheadPercent = fullTimelineDuration > 0
    ? Math.max(0, Math.min(100, timelinePosition / fullTimelineDuration * 100))
    : 0;
  const webPreviewFilter = [FILTERS[activeFilter], FILTERS[settings.editing_style], activeEdit ? `brightness(${1 + activeEdit.brightness})` : null].filter(Boolean).join(' ');
  const titleProgress = playing ? Math.max(0, Math.min(1, timelinePosition / 0.45)) : 1;
  const titleAnimationStyle = settings.title_animation === 'fade'
    ? { opacity: titleProgress }
    : settings.title_animation === 'pop'
      ? { opacity: titleProgress, transform: [{ scale: 0.65 + titleProgress * 0.35 }] }
      : settings.title_animation === 'slide-up'
        ? { opacity: titleProgress, transform: [{ translateY: 18 * (1 - titleProgress) }] }
        : {};
  const titleWords = settings.title_text.split(/\s+/);
  const displayedTitle = settings.title_animation === 'typewriter'
    ? settings.title_text.slice(0, Math.ceil(settings.title_text.length * titleProgress))
    : settings.title_animation === 'word-by-word'
      ? titleWords.slice(0, Math.ceil(titleWords.length * titleProgress)).join(' ')
      : settings.title_text;
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const previewHeight = Math.max(235, Math.min(windowHeight * 0.55, 560));
  const [ratioWidth, ratioHeight] = settings.aspect_ratio.split(':').map(Number);
  const outputRatio = ratioWidth > 0 && ratioHeight > 0 ? ratioWidth / ratioHeight : 9 / 16;
  const previewMediaWidth = Math.min(windowWidth, previewHeight * outputRatio);
  const previewMediaHeight = Math.min(previewHeight, windowWidth / outputRatio);

  const configurePlayer = (videoPlayer: any) => {
    videoPlayer.loop = false;
    videoPlayer.muted = true;
    videoPlayer.timeUpdateEventInterval = 0.12;
    if (Platform.OS === 'android') {
      // The OnePlus 6T hit the Android heap limit while ExoPlayer buffered a
      // remote MP4. Bound both players so preloading the next cut stays light.
      videoPlayer.bufferOptions = {
        preferredForwardBufferDuration: 3,
        minBufferForPlayback: 0.75,
        maxBufferBytes: 6 * 1024 * 1024,
        prioritizeTimeOverSizeThreshold: false,
      };
    } else if (Platform.OS === 'ios') {
      videoPlayer.bufferOptions = { preferredForwardBufferDuration: 3 };
    }
  };
  // Keep the upcoming clip prepared on a second native player so the reel can
  // switch at the cut without waiting for a remote video to load.
  const playerAUri = activePlayerSlot === 0 ? activeVideoUri : nextVideoUri;
  const playerBUri = activePlayerSlot === 1 ? activeVideoUri : nextVideoUri;
  const playerA = useVideoPlayer(playerAUri, configurePlayer);
  const playerB = useVideoPlayer(playerBUri, configurePlayer);
  const player = activePlayerSlot === 0 ? playerA : playerB;
  const standbyPlayer = activePlayerSlot === 0 ? playerB : playerA;
  const standbyUri = activePlayerSlot === 0 ? playerBUri : playerAUri;
  activePlayerSlotRef.current = activePlayerSlot;
  currentPlayer.current = player;

  const preparePlayer = useCallback((targetPlayer: any) => {
    const shot = currentActiveShot.current;
    if (shot < 0 || !currentActiveUri.current || targetPlayer.status !== 'readyToPlay') return;
    if (preparedPlayer.current?.player === targetPlayer && preparedPlayer.current?.shot === shot) return;
    preparedPlayer.current = { player: targetPlayer, shot };
    const start = desiredShot.current === shot ? desiredTime.current : currentTrimStart.current;
    const safeStart = Math.min(start, Math.max(0, (targetPlayer.duration || start + 0.05) - 0.05));
    targetPlayer.currentTime = safeStart;
    clipHasPlayed.current = false;
    clipStarted.current = false;
    loadedPlayerShot.current = shot;
    setCurrentTime(safeStart);
    if (autoAdvance.current) {
      targetPlayer.play();
      setPlaying(true);
    }
  }, []);

  const refreshFailedMedia = useCallback((failedPlayer: any) => {
    const shot = currentActiveShot.current;
    const failedUri = currentActiveUri.current;
    if (failedPlayer !== currentPlayer.current || shot < 0 || !failedUri) return;
    if (refreshedMediaShots.current.has(shot)) {
      autoAdvance.current = false;
      setPlaying(false);
      setRenderError('This clip could not load. Check your connection and try again.');
      return;
    }

    refreshedMediaShots.current.add(shot);
    const resumeAfterRefresh = playingRef.current || autoAdvance.current || failedPlayer.playing;
    autoAdvance.current = resumeAfterRefresh;
    desiredShot.current = shot;
    desiredTime.current = currentTrimStart.current;
    api.getProject(id).then((loaded) => {
      const clip = (loaded.clips || []).find((item: any, index: number) => shotIndex(item, index) === shot);
      if (!clip?.video_url || clip.video_url === failedUri) throw new Error('The clip link could not be refreshed.');
      setProject(loaded);
      setRenderError('');
    }).catch(() => {
      if (currentActiveShot.current !== shot) return;
      autoAdvance.current = false;
      setPlaying(false);
      setRenderError('This clip could not load. Check your connection and try again.');
    });
  }, [id]);

  const advanceToNextClip = useCallback((sourcePlayer?: any) => {
    if (sourcePlayer && sourcePlayer !== currentPlayer.current) return true;
    if (autoAdvance.current) return true;
    if (nextSegment && nextIncludedShot === activeShot) {
      desiredShot.current = activeShot;
      desiredTime.current = nextSegment.start;
      player.currentTime = nextSegment.start;
      setCurrentTime(nextSegment.start);
      return true;
    }
    if (nextIncludedClip && nextIncludedShot !== null) {
      const start = nextSegment?.start ?? editForShot(settings, nextIncludedShot).trim_start_seconds;
      autoAdvance.current = true;
      desiredShot.current = nextIncludedShot;
      desiredTime.current = start;
      activePlayerSlotRef.current = 1 - activePlayerSlotRef.current;
      setActivePlayerSlot(activePlayerSlotRef.current);
      setSelectedShot(nextIncludedShot);
      setCurrentTime(start);
      player.pause();
      return true;
    }
    playbackFinished.current = true;
    player.pause();
    setPlaying(false);
    return false;
  }, [activeShot, nextIncludedClip, nextIncludedShot, nextSegment, player, settings]);
  advanceRef.current = advanceToNextClip;

  useEffect(() => {
    playbackFinished.current = false;
    preparedPlayer.current = null;
    loadedPlayerShot.current = -1;
    sourceLoadedShot.current = activeVideoUri ? activeShot : -1;
    player.pause();
    if (!activeVideoUri) {
      setCurrentTime(0);
      setPlayerDuration(0);
      setPlaying(false);
      return;
    }
    const start = desiredShot.current === activeShot ? desiredTime.current : activeTrimStart;
    desiredShot.current = activeShot;
    desiredTime.current = start;
    setCurrentTime(start);
    setPlayerDuration(Math.max(0, activeSourceDuration));
  }, [activeVideoUri, activeTrimStart, activeSourceDuration, activeShot, player, preparePlayer]);

  useEffect(() => {
    if (standbyPlayer.playing) standbyPlayer.pause();
  }, [standbyPlayer, standbyUri]);

  useEffect(() => {
    player.playbackRate = activeEdit?.playback_rate || 1;
  }, [activeEdit?.playback_rate, player]);

  useEffect(() => {
    if (!activeVideoUri || !autoAdvance.current) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const startWhenReady = () => {
      if (currentActiveShot.current !== activeShot || !autoAdvance.current) return;
      if (player.status === 'readyToPlay') {
        if (preparedPlayer.current?.player === player && preparedPlayer.current?.shot === activeShot) {
          if (!player.playing) player.play();
        } else {
          preparePlayer(player);
        }
      }
      if (autoAdvance.current && attempts++ < 80) timer = setTimeout(startWhenReady, 100);
    };
    timer = setTimeout(startWhenReady, 100);
    return () => clearTimeout(timer);
  }, [activeVideoUri, activeShot, player, preparePlayer]);

  useEffect(() => {
    const timeSub = player.addListener('timeUpdate', ({ currentTime: time }) => {
      if (player !== currentPlayer.current) return;
      if (playbackFinished.current) return;
      if (loadedPlayerShot.current !== currentActiveShot.current) return;
      const clipEnd = currentClipEnd.current;
      if (Math.abs(time - player.currentTime) > 0.5) return;
      // A native player can send the previous source's last timestamps just
      // after a source replacement. Ignore it unless it belongs to the active player.
      if (!clipStarted.current) {
        if (time < currentTrimStart.current - 0.25 || time > clipEnd + 0.24) return;
        clipStarted.current = true;
      }
      // The player can emit one final timestamp from the outgoing source just
      // after a replacement. Count progress only inside this clip's window.
      // Ignore timestamps beyond the current clip's end; they belong to the
      // previous source and must not finish a shorter incoming clip.
      if (time > clipEnd + 0.24) return;
      if (isClipProgress(time, currentTrimStart.current, clipEnd)) clipHasPlayed.current = true;
      if (time >= clipEnd - 0.04) {
        if (!advanceRef.current(player)) {
          player.currentTime = clipEnd;
          setCurrentTime(clipEnd);
        }
      } else {
        setCurrentTime(time);
      }
    });
    const sourceSub = player.addListener('sourceLoad', ({ duration, videoSource }) => {
      if (player !== currentPlayer.current) return;
      setPlayerDuration(duration || 0);
      const uri = typeof videoSource === 'string'
        ? videoSource
        : videoSource && typeof videoSource === 'object' ? videoSource.uri : null;
      if (uri && uri === currentActiveUri.current) {
        const shot = currentActiveShot.current;
        sourceLoadedShot.current = shot;
        if (duration > 0) setSourceDurations((current) => current[shot] === duration ? current : { ...current, [shot]: duration });
        preparePlayer(player);
      }
    });
    const statusSub = player.addListener('statusChange', ({ status }) => {
      if (player !== currentPlayer.current) return;
      const shot = currentActiveShot.current;
      if (status === 'readyToPlay' && sourceLoadedShot.current === shot) {
        setTimeout(() => {
          if (sourceLoadedShot.current === shot && currentActiveShot.current === shot) preparePlayer(player);
        }, 0);
      } else if (status === 'error') {
        refreshFailedMedia(player);
      }
    });
    const playingSub = player.addListener('playingChange', ({ isPlaying }) => {
      if (player === currentPlayer.current) {
        setPlaying(isPlaying);
        if (isPlaying) autoAdvance.current = false;
      }
    });
    const endSub = player.addListener('playToEnd', () => {
      if (player !== currentPlayer.current) return;
      if (loadedPlayerShot.current !== currentActiveShot.current) return;
      // A playToEnd from the previous source can arrive after the next clip has
      // loaded. Ignore it until the current clip itself has reached its end.
      // The native duration handles overestimated recording metadata; position
      // rejects delayed end events from a previous source on the same player.
      if (!shouldAdvanceOnEndEvent(clipHasPlayed.current, player.currentTime, currentClipEnd.current, player.duration)) return;
      advanceRef.current(player);
    });
    // A short clip can finish before React attaches listeners to its new player.
    // Check readiness after subscribing so the next segment still starts.
    if (sourceLoadedShot.current === currentActiveShot.current) preparePlayer(player);
    if (player.status === 'error') refreshFailedMedia(player);
    return () => { timeSub.remove(); sourceSub.remove(); statusSub.remove(); playingSub.remove(); endSub.remove(); };
  }, [player, preparePlayer, refreshFailedMedia]);

  const pushHistory = (current: EditorSettings) => {
    historyBack.current = [...historyBack.current.slice(-39), current];
    historyForward.current = [];
  };

  const update = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
    setSettings((current) => {
      pushHistory(current);
      const textStyleKey = ['title_font', 'title_size', 'title_color', 'title_position', 'title_animation'].includes(String(key));
      return { ...current, [key]: value, ...(textStyleKey ? { title_style_id: 'custom' } : {}) };
    });
    setDirty(true);
    setNotice('');
  };

  const applyTextStyle = (styleId: string) => {
    const preset = getTextStyle(styleId);
    setSettings((current) => {
      pushHistory(current);
      return { ...current, title_style_id: preset.id, title_font: preset.font, title_size: preset.size,
        title_color: preset.color, title_position: preset.position, title_animation: preset.animation };
    });
    setDirty(true);
    setNotice('');
  };

  const updateClip = (shot: number, values: Partial<ClipEdit>) => {
    setSettings((current) => {
      pushHistory(current);
      const clipEdits = current.clip_edits.map((edit) => edit.shot_index === shot ? { ...edit, ...values } : edit);
      const clipEdit = clipEdits.find((edit) => edit.shot_index === shot);
      const caption_edits = clipEdit
        ? current.caption_edits.map((caption) => {
          if (caption.shot_index !== shot) return caption;
          const available = Math.max(0.25, (clipEdit.trim_end_seconds - clipEdit.trim_start_seconds) / clipEdit.playback_rate);
          const start = Math.max(0, Math.min(available - 0.15, caption.start_seconds));
          return { ...caption, start_seconds: start, end_seconds: Math.max(start + 0.15, Math.min(available, caption.end_seconds)) };
        })
        : current.caption_edits;
      return {
        ...current,
        clip_edits: clipEdits,
        caption_edits,
      };
    });
    setDirty(true);
    setNotice('');
  };

  const updateCaption = (shot: number, values: Partial<CaptionEdit>, recordHistory = true) => {
    setSettings((current) => {
      if (recordHistory) pushHistory(current);
      const existing = current.caption_edits.find((edit) => edit.shot_index === shot);
      const fallback = { ...activeCaption, shot_index: shot };
      const next = { ...(existing || fallback), ...values, shot_index: shot };
      return {
        ...current,
        caption_edits: existing
          ? current.caption_edits.map((edit) => edit.shot_index === shot ? next : edit)
          : [...current.caption_edits, next],
      };
    });
    setDirty(true);
    setNotice('');
  };
  const updateCaptionRef = useRef(updateCaption);
  updateCaptionRef.current = updateCaption;
  const captionDragOrigin = useRef({ x: 50, y: 84 });
  const captionPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => captionPositionMode,
    onMoveShouldSetPanResponder: (_event, gesture) => captionPositionMode && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onPanResponderGrant: () => {
      captionDragOrigin.current = { x: captionValuesRef.current.position_x, y: captionValuesRef.current.position_y };
      pushHistory(settingsRef.current);
    },
    onPanResponderMove: (_event, gesture) => {
      const x = Math.max(0, Math.min(100, captionDragOrigin.current.x + gesture.dx / Math.max(1, previewMediaWidth - captionLayout.width) * 100));
      const y = Math.max(0, Math.min(100, captionDragOrigin.current.y + gesture.dy / Math.max(1, previewMediaHeight - captionLayout.height) * 100));
      updateCaptionRef.current(activeShot, { position_x: x, position_y: y }, false);
    },
    onPanResponderTerminationRequest: () => false,
  }), [activeShot, captionLayout.height, captionLayout.width, captionPositionMode, previewMediaHeight, previewMediaWidth]);

  const adjustCaptionTime = (field: 'start_seconds' | 'end_seconds', delta: number) => {
    const duration = Math.max(0.25, ((activeEdit?.trim_end_seconds || 0) - (activeEdit?.trim_start_seconds || 0)) / (activeEdit?.playback_rate || 1));
    if (field === 'start_seconds') {
      updateCaption(activeShot, { start_seconds: Math.max(0, Math.min(activeCaption.end_seconds - 0.15, Math.round((activeCaption.start_seconds + delta) * 10) / 10)) });
    } else {
      updateCaption(activeShot, { end_seconds: Math.max(activeCaption.start_seconds + 0.15, Math.min(duration, Math.round((activeCaption.end_seconds + delta) * 10) / 10)) });
    }
  };

  const undo = () => {
    const previous = historyBack.current.pop();
    if (!previous) return;
    historyForward.current = [...historyForward.current, settings];
    setSettings(previous);
    setDirty(true);
    setNotice('');
    Haptics.selectionAsync().catch(() => {});
  };

  const redo = () => {
    const next = historyForward.current.pop();
    if (!next) return;
    historyBack.current = [...historyBack.current, settings];
    setSettings(next);
    setDirty(true);
    setNotice('');
    Haptics.selectionAsync().catch(() => {});
  };

  const selectClip = (shot: number, segmentStart?: number) => {
    refreshedMediaShots.current.delete(shot);
    autoAdvance.current = false;
    playbackFinished.current = false;
    setCaptionPositionMode(false);
    desiredShot.current = shot;
    setSelectedShot(shot);
    const edit = editForShot(settings, shot);
    const start = segmentStart ?? edit.trim_start_seconds;
    desiredTime.current = start;
    setCurrentTime(start);
    player.pause();
    player.currentTime = start;
    setPlaying(false);
  };

  const togglePlayback = () => {
    if (!activeClip?.video_url) return;
    if (player.playing) {
      autoAdvance.current = false;
      player.pause();
      setPlaying(false);
    } else {
      playbackFinished.current = false;
      autoAdvance.current = false;
      if (currentTime >= activeClipEnd - 0.05) {
        player.currentTime = activeEdit?.trim_start_seconds || 0;
        setCurrentTime(activeEdit?.trim_start_seconds || 0);
      }
      player.play();
      setPlaying(true);
    }
  };

  const playFullReel = () => {
    const firstSegment = orderedSegments[0];
    if (!firstSegment) return;
    const firstShot = firstSegment.shot;
    const start = firstSegment.start;
    playbackFinished.current = false;
    refreshedMediaShots.current.clear();
    autoAdvance.current = false;
    setCaptionPositionMode(false);
    if (player.playing) player.pause();
    desiredShot.current = firstShot;
    desiredTime.current = start;
    setCurrentTime(start);
    if (firstShot === activeShot) {
      player.currentTime = start;
      player.play();
      setPlaying(true);
    } else {
      autoAdvance.current = true;
      setSelectedShot(firstShot);
      setPlaying(true);
    }
  };

  const seekTimelineTo = (timelineTime: number) => {
    if (fullTimelineDuration <= 0) return;
    playbackFinished.current = false;
    const boundedTime = Math.max(0, Math.min(fullTimelineDuration, timelineTime));
    const included = orderedSegments;
    if (!included.length) return;

    const position = locateTimelinePosition(included.map((item) => ({
      start: item.start,
      end: item.end,
      playbackRate: editForShot(settings, item.shot).playback_rate,
    })), boundedTime);
    if (!position) return;
    const target = included[position.index];
    const sourceTime = position.sourceTime;

    autoAdvance.current = false;
    setCaptionPositionMode(false);
    desiredShot.current = target.shot;
    desiredTime.current = sourceTime;
    player.pause();
    if (target.shot === activeShot) {
      player.currentTime = sourceTime;
      setCurrentTime(sourceTime);
    } else {
      setCurrentTime(sourceTime);
      setSelectedShot(target.shot);
    }
    setPlaying(false);
  };
  seekTimelineRef.current = seekTimelineTo;

  const timelinePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => timelineDurationRef.current > 0 && Math.abs(gesture.dx) > 2,
    onPanResponderGrant: () => {
      timelineDragOrigin.current = timelinePositionRef.current;
      seekTimelineRef.current(timelineDragOrigin.current);
    },
    onPanResponderMove: (_event, gesture) => {
      const width = Math.max(1, timelineWidthRef.current);
      const secondsPerPixel = timelineDurationRef.current / width;
      seekTimelineRef.current(timelineDragOrigin.current + gesture.dx * secondsPerPixel);
    },
    onPanResponderRelease: (_event, gesture) => {
      const width = Math.max(1, timelineWidthRef.current);
      const secondsPerPixel = timelineDurationRef.current / width;
      seekTimelineRef.current(timelineDragOrigin.current + gesture.dx * secondsPerPixel);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);

  const adjustTrim = (shot: number, edge: 'in' | 'out', amount: number, duration: number) => {
    const edit = editForShot(settings, shot);
    if (edge === 'in') {
      const next = Math.max(0, Math.min(edit.trim_end_seconds - 0.25, edit.trim_start_seconds + amount));
      updateClip(shot, { trim_start_seconds: Math.round(next * 10) / 10 });
    } else {
      const next = Math.max(edit.trim_start_seconds + 0.25, Math.min(duration, edit.trim_end_seconds + amount));
      updateClip(shot, { trim_end_seconds: Math.round(next * 10) / 10 });
    }
  };

  const splitAtPlayhead = () => {
    if (!activeSegment || currentTime < activeSegment.start + 0.25 || currentTime > activeSegment.end - 0.25) {
      setNotice('Move the playhead at least 0.25 seconds inside the selected clip to split it.');
      return;
    }
    const points = settings.clip_splits[activeShot] || [];
    if (points.some((point) => Math.abs(point - currentTime) < 0.15)) {
      setNotice('This clip is already split at that point.');
      return;
    }
    update('clip_splits', {
      ...settings.clip_splits,
      [activeShot]: [...points, currentTime].sort((a, b) => a - b),
    });
    setNotice('Clip split at the playhead');
  };

  const moveClip = (shot: number, direction: -1 | 1) => {
    const currentOrder = [...settings.clip_order];
    const index = currentOrder.indexOf(shot);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= currentOrder.length) return;
    [currentOrder[index], currentOrder[target]] = [currentOrder[target], currentOrder[index]];
    update('clip_order', currentOrder);
  };

  const save = async () => {
    if (!id || saving || rendering) return;
    setSaving(true);
    setRenderError('');
    try {
      await api.saveEditSettings(id, settings as any);
      autosaveFailedFor.current = null;
      setDirty(false);
      setNotice('Changes saved');
    } catch (error: any) {
      setRenderError(error.message || 'Could not save your edits.');
    } finally { setSaving(false); }
  };

  const render = async () => {
    if (!id || rendering || saving) return;
    if (!settings.clip_edits.some((edit) => edit.included)) {
      setRenderError('Keep at least one clip in your reel before exporting.');
      return;
    }
    setRendering(true);
    setRenderError('');
    setNotice('');
    setRenderStage('Applying your edits…');
    try {
      const exportSettings = { ...settings, clip_edits: settings.clip_edits.map((edit) => {
        const clip = orderedClips.find((item: any, index: number) => shotIndex(item, index) === edit.shot_index);
        const { start, end } = clipWindow(clip, edit.shot_index, edit, sourceDurations);
        return { ...edit, trim_start_seconds: start, trim_end_seconds: end };
      }) };
      await api.saveEditSettings(id, exportSettings as any);
      setSettings(exportSettings);
      setDirty(false);
      await api.export(id, exportSettings as any, (status) => setRenderStage(status));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace({ pathname: '/project/[id]/final', params: { id } });
    } catch (error: any) {
      setRenderError(error.message || 'Could not render your video.');
    } finally {
      setRendering(false);
      setRenderStage('');
    }
  };

  const makeMyReel = async () => {
    if (!id || autoEditing || rendering || saving) return;
    setAutoEditing(true);
    setToolError('');
    try {
      const suggestion = await api.autoEdit(id, settings.editing_style, settings.pacing);
      setSettings((current) => {
        pushHistory(current);
        const suggestions = new Map((suggestion.clip_edits || []).map((edit: ClipEdit) => [edit.shot_index, edit]));
        const clip_edits = current.clip_edits.map((edit) => ({ ...edit, ...(suggestions.get(edit.shot_index) || {}) }));
        const clip_splits = Object.fromEntries(Object.entries(current.clip_splits).map(([shot, points]) => {
          const edit = clip_edits.find((item) => item.shot_index === Number(shot));
          return [shot, edit ? points.filter((point) => point > edit.trim_start_seconds && point < edit.trim_end_seconds) : []];
        }).filter(([, points]) => points.length));
        const caption_edits = current.caption_edits.map((caption) => {
          const edit = clip_edits.find((item) => item.shot_index === caption.shot_index);
          if (!edit) return caption;
          const available = Math.max(0.25, (edit.trim_end_seconds - edit.trim_start_seconds) / edit.playback_rate);
          const start = Math.max(0, Math.min(available - 0.15, caption.start_seconds));
          return { ...caption, start_seconds: start, end_seconds: Math.max(start + 0.15, Math.min(available, caption.end_seconds)) };
        });
        return {
          ...current,
          clip_order: suggestion.clip_order,
          clip_edits,
          clip_splits,
          caption_edits,
          editing_style: suggestion.editing_style,
        };
      });
      setDirty(true);
      setNotice(suggestion.summary || 'AI first cut is ready to preview.');
      setTool(null);
    } catch (error: any) {
      setToolError(error.message || 'AI could not prepare a first cut. Your edits are safe.');
    } finally {
      setAutoEditing(false);
    }
  };

  const syncToMusicBeats = async () => {
    if (!id || !project?.soundtrack?.storage_path || beatSyncing || saving || rendering) return;
    setBeatSyncing(true);
    setToolError('');
    try {
      const analysis = await api.analyzeMusicBeats(id);
      const suggestions = syncClipEndsToBeats(orderedClips.map((clip: any, index: number) => {
        const shot = shotIndex(clip, index);
        const edit = editForShot(settings, shot);
        return {
          shotIndex: shot,
          sourceDuration: sourceDurations[shot] || Number(clip?.duration_seconds) || 5,
          edit,
        };
      }), analysis.beat_times || []);
      if (!suggestions.size) throw new Error('Could not find safe beat-aligned cut points in this track.');

      setSettings((current) => {
        pushHistory(current);
        const clip_edits = current.clip_edits.map((edit) => ({
          ...edit,
          ...(suggestions.has(edit.shot_index) ? { trim_end_seconds: suggestions.get(edit.shot_index)! } : {}),
        }));
        const clip_splits = Object.fromEntries(Object.entries(current.clip_splits).map(([shot, points]) => {
          const edit = clip_edits.find((item) => item.shot_index === Number(shot));
          return [shot, edit ? points.filter((point) => point > edit.trim_start_seconds && point < edit.trim_end_seconds) : []];
        }).filter(([, points]) => points.length));
        const caption_edits = current.caption_edits.map((caption) => {
          const edit = clip_edits.find((item) => item.shot_index === caption.shot_index);
          if (!edit) return caption;
          const available = Math.max(0.25, (edit.trim_end_seconds - edit.trim_start_seconds) / edit.playback_rate);
          const start = Math.max(0, Math.min(available - 0.15, caption.start_seconds));
          return { ...caption, start_seconds: start, end_seconds: Math.max(start + 0.15, Math.min(available, caption.end_seconds)) };
        });
        return { ...current, clip_edits, clip_splits, caption_edits };
      });
      setDirty(true);
      setNotice(`Suggested cuts aligned to about ${analysis.bpm} BPM. Preview, adjust, or undo before saving.`);
      setTool(null);
    } catch (error: any) {
      setToolError(error.message || 'Could not analyze the music. Your edits are safe.');
    } finally {
      setBeatSyncing(false);
    }
  };

  const addClip = async () => {
    if (!id || addingClip) return;
    setAddingClip(true);
    setAddClipError('');
    try {
      if (dirty) {
        await api.saveEditSettings(id, settings as any);
        setDirty(false);
      }
      let storyboard = Array.isArray(project?.storyboard) ? [...project.storyboard] : [];
      const nextUnfilmed = storyboard.findIndex((_shot: any, index: number) => !clips.some((clip: any) => shotIndex(clip, -1) === index));
      let nextShot = nextUnfilmed;
      if (nextShot < 0) {
        const previous = storyboard[storyboard.length - 1] || {};
        nextShot = storyboard.length;
        storyboard = [...storyboard, {
          ...previous,
          index: nextShot,
          title: 'Extra moment',
          description: 'Capture another memorable detail for your reel.',
          direction: 'Frame the moment clearly and hold the phone steady.',
          camera_movement: 'static',
          duration_seconds: 5,
          on_screen_text: '',
          status: 'pending',
        }];
        await api.updateStoryboard(id, storyboard);
        setProject((current: any) => ({ ...current, storyboard }));
      }
      router.push({ pathname: '/project/[id]/camera', params: { id, shot: String(nextShot) } });
    } catch (error: any) {
      setAddClipError(error.message || 'Could not add another clip.');
    } finally { setAddingClip(false); }
  };

  const retakeClip = async () => {
    if (!id || activeShot < 0 || retakingClip || saving || rendering) return;
    setRetakingClip(true);
    setToolError('');
    try {
      if (dirty) {
        await api.saveEditSettings(id, settings as any);
        setDirty(false);
      }
      setTool(null);
      router.push({
        pathname: '/project/[id]/camera',
        params: { id, shot: String(activeShot), retake: '1' },
      });
    } catch (error: any) {
      setToolError(error.message || 'Could not open this shot for a retake.');
    } finally {
      setRetakingClip(false);
    }
  };

  const openTool = (name: ToolName) => {
    setCaptionPositionMode(false);
    setToolError('');
    setTool(name);
  };

  const chooseAudio = async () => {
    if (!id) return;
    setToolError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
      const file = result.assets?.[0];
      if (result.canceled || !file) return;
      if (file.size && file.size > 25 * 1024 * 1024) {
        setToolError('Choose an audio file smaller than 25 MB.');
        return;
      }
      setAudioBusy(true);
      const saved = await api.saveSoundtrack(id, {
        uri: file.uri, name: file.name, mimeType: file.mimeType || undefined, file: file.file || undefined,
      });
      setProject((current: any) => ({ ...current, soundtrack: saved }));
      setNotice('Audio track added');
    } catch (error: any) {
      setToolError(error.message || 'Could not add this audio file.');
    } finally { setAudioBusy(false); }
  };

  const chooseBrollImage = async () => {
    if (!id) return;
    setToolError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
      const file = result.assets?.[0];
      if (result.canceled || !file) return;
      setAudioBusy(true);
      await api.addBrollImage(id, { uri: file.uri, name: file.name, mimeType: file.mimeType || undefined, file: file.file || undefined, size: file.size || undefined }, timelinePosition, Math.min(3, Math.max(0.5, estimatedDuration - timelinePosition)));
      const refreshed = await api.getProject(id);
      setProject(refreshed);
      const added = refreshed.edit_json?.tracks?.find((track: any) => track.kind === 'overlay')?.items?.slice(-1)[0];
      setSelectedBroll(added?.id || null);
      setNotice('B-roll image added to the timeline');
    } catch (error: any) {
      setToolError(error.message || 'Could not add this B-roll image.');
    } finally { setAudioBusy(false); }
  };

  const removeSelectedBroll = async () => {
    if (!id || !selectedBroll) return;
    setAudioBusy(true);
    setToolError('');
    try {
      await api.removeBroll(id, selectedBroll);
      setProject(await api.getProject(id));
      setSelectedBroll(null);
      setNotice('B-roll image removed');
    } catch (error: any) {
      setToolError(error.message || 'Could not remove this B-roll image.');
    } finally { setAudioBusy(false); }
  };

  const chooseVoiceover = async () => {
    if (!id) return;
    setToolError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
      const file = result.assets?.[0];
      if (result.canceled || !file) return;
      if (file.size && file.size > 25 * 1024 * 1024) {
        setToolError('Choose a voice recording smaller than 25 MB.');
        return;
      }
      setAudioBusy(true);
      const saved = await api.saveVoiceover(id, {
        uri: file.uri, name: file.name, mimeType: file.mimeType || undefined, file: file.file || undefined,
      });
      setProject((current: any) => ({ ...current, voiceover: saved }));
      setNotice('Voiceover added as a separate track');
    } catch (error: any) {
      setToolError(error.message || 'Could not add this voice recording.');
    } finally { setAudioBusy(false); }
  };

  const removeAudio = () => {
    if (!id) return;
    Alert.alert('Remove music track?', 'Your separate voiceover track will stay in the reel.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setAudioBusy(true);
        try {
          await api.removeSoundtrack(id);
          setProject((current: any) => ({ ...current, soundtrack: null }));
          setNotice('Audio track removed');
        } catch (error: any) { setToolError(error.message || 'Could not remove the audio track.'); }
        finally { setAudioBusy(false); }
      } },
    ]);
  };

  const startVoiceRecording = async () => {
    setToolError('');
    await beginRecording();
  };

  const beginRecording = async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Allow microphone access to record a voiceover.');
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordingVoice(true);
    } catch (error: any) { setToolError(error.message || 'Could not start voice recording.'); }
  };

  const stopVoiceRecording = async () => {
    if (!id) return;
    setToolError('');
    setAudioBusy(true);
    try {
      await recorder.stop();
      setRecordingVoice(false);
      const uri = recorder.uri;
      if (!uri) throw new Error('The voice recording was empty. Please try again.');
      const audioBlob = Platform.OS === 'web' ? await fetch(uri).then((response) => response.blob()) : undefined;
      const mimeType = audioBlob?.type || 'audio/mp4';
      const extension = mimeType.includes('webm') ? 'webm' : mimeType.includes('mpeg') ? 'mp3' : 'm4a';
      const saved = await api.saveVoiceover(id, {
        uri, name: `voiceover-${Date.now()}.${extension}`, mimeType, file: audioBlob,
      });
      setProject((current: any) => ({ ...current, voiceover: saved }));
      setNotice('Voiceover added as a separate track');
    } catch (error: any) {
      setToolError(error.message || 'Could not save your voice recording.');
    } finally { setAudioBusy(false); }
  };

  const removeVoiceover = () => {
    if (!id) return;
    Alert.alert('Remove voiceover?', 'The music track will stay in your reel.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setAudioBusy(true);
        try {
          await api.removeVoiceover(id);
          setProject((current: any) => ({ ...current, voiceover: null }));
          setNotice('Voiceover removed');
        } catch (error: any) { setToolError(error.message || 'Could not remove the voiceover.'); }
        finally { setAudioBusy(false); }
      } },
    ]);
  };

  const estimatedDuration = orderedClips.reduce((total: number, clip: any, index: number) => {
    const shot = shotIndex(clip, index);
    const edit = editForShot(settings, shot);
    return edit.included ? total + clipWindow(clip, shot, edit, sourceDurations).duration / edit.playback_rate : total;
  }, 0) * (settings.editing_style === 'fast_pace' ? 0.8 : 1);
  const includedCount = orderedClips.filter((clip: any, index: number) => editForShot(settings, shotIndex(clip, index)).included).length;

  return (
    <View style={styles.root} testID="export-screen">
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerIcon} accessibilityLabel="Back to project">
            <Ionicons name="chevron-back" size={25} color="#F8F8FA" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>{project?.title || 'Edit your reel'}</Text>
            <Text style={styles.headerMeta}>{dirty ? 'Unsaved changes' : notice || 'Saved to project'}</Text>
          </View>
          <Pressable onPress={() => void save()} style={styles.headerIcon} disabled={!dirty || saving || rendering} accessibilityLabel="Save edits">
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="bookmark-outline" size={21} color={dirty ? '#fff' : '#777982'} />}
          </Pressable>
          <Pressable onPress={() => openTool('Export settings')} style={styles.headerIcon} accessibilityLabel="Export settings">
            <Ionicons name="options-outline" size={20} color="#D9DADE" />
          </Pressable>
          <Pressable onPress={() => void render()} style={[styles.exportButton, rendering && styles.buttonDisabled]} disabled={rendering || saving} testID="export-render-button">
            {rendering ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="download-outline" size={16} color="#fff" />}
            <Text style={styles.exportButtonText}>{rendering ? 'Rendering' : 'Export'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView ref={editorScrollRef} style={styles.editorScroll} contentContainerStyle={styles.editorBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.preview, { height: previewHeight }]}>
          <View style={[styles.previewMedia, { width: previewMediaWidth, height: previewMediaHeight }]}>
            {activeClip?.frame_url ? <Image source={{ uri: activeClip.frame_url }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
            {activeClip?.video_url ? (
              <VideoView
                player={player}
                style={[StyleSheet.absoluteFill, Platform.OS === 'web' && webPreviewFilter ? ({ filter: webPreviewFilter } as any) : null]}
                contentFit={settings.fit_mode === 'fit' ? 'contain' : 'cover'}
                nativeControls={false}
                fullscreenOptions={{ enable: false }}
              />
            ) : (
              <View style={styles.previewEmpty}>
                <Ionicons name="videocam-outline" size={38} color="#737681" />
                <Text style={styles.previewEmptyText}>{orderedClips.length ? 'This clip preview is not available' : 'Your clip preview will appear here'}</Text>
              </View>
            )}
            {Platform.OS !== 'web' && (activeFilter !== 'original' || settings.editing_style !== 'original') ? (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: nativeTint(activeFilter, settings.editing_style) }]} />
            ) : null}
            {Platform.OS !== 'web' && activeEdit?.brightness ? (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: activeEdit.brightness > 0 ? '#fff' : '#000', opacity: Math.min(0.5, Math.abs(activeEdit.brightness)) }]} />
            ) : null}
            {activeBroll?.signed_url ? (
              <Image source={{ uri: activeBroll.signed_url }} contentFit="cover" style={{
                position: 'absolute', left: `${Math.max(0, Number(activeBroll.frame?.x ?? 70) - Number(activeBroll.frame?.width ?? 38) / 2)}%`,
                top: `${Math.max(0, Number(activeBroll.frame?.y ?? 72) - Number(activeBroll.frame?.height ?? 30) / 2)}%`,
                width: `${Number(activeBroll.frame?.width ?? 38)}%`, height: `${Number(activeBroll.frame?.height ?? 30)}%`,
                borderRadius: Number(activeBroll.frame?.radius ?? 18) * previewMediaWidth / 1080, borderWidth: Math.max(1, previewMediaWidth * 0.004), borderColor: '#fff',
              }} />
            ) : null}
            {showTitleOverlay && (
              <View pointerEvents="none" style={[styles.titleOverlay, settings.title_position === 'top' ? styles.titleTop : settings.title_position === 'center' ? styles.titleCenter : styles.titleBottom]}>
                <Text numberOfLines={2} style={[
                  styles.previewTitle,
                  { color: TITLE_COLORS[settings.title_color] || '#fff', fontFamily: fontsLoaded ? fontFamily(settings.title_font, ['bebas', 'anton', 'archivo-black', 'dm-serif', 'marker'].includes(settings.title_font) ? 400 : 700) : undefined,
                    fontSize: textSizePixels('title', settings.title_size, Math.min(previewMediaWidth, previewMediaHeight)),
                    fontWeight: fontsLoaded ? undefined : '700',
                    ...titleAnimationStyle },
                  settings.title_color === 'black' && styles.previewTitleDark,
                ]}>{displayedTitle}</Text>
              </View>
            )}
            {settings.captions_enabled && !!captionText && (captionIsInTime || captionPositionMode) && (
              <View
                {...(captionPositionMode ? captionPanResponder.panHandlers : {})}
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  if (Math.abs(width - captionLayout.width) > 1 || Math.abs(height - captionLayout.height) > 1) setCaptionLayout({ width, height });
                }}
                style={[
                  styles.captionOverlay,
                  {
                    left: Math.max(0, (previewMediaWidth - captionLayout.width) * activeCaption.position_x / 100),
                    top: Math.max(0, (previewMediaHeight - captionLayout.height) * activeCaption.position_y / 100),
                    maxWidth: previewMediaWidth * 0.92,
                  },
                  captionPositionMode && styles.captionOverlayEditing,
                ]}
              >
                <Text numberOfLines={3} style={[
                  styles.captionText,
                  {
                    fontSize: textSizePixels('caption', activeCaption.size, Math.min(previewMediaWidth, previewMediaHeight)),
                    fontFamily: fontsLoaded ? fontFamily(activeCaption.font, ['bebas', 'anton', 'archivo-black', 'dm-serif', 'marker'].includes(activeCaption.font) ? 400 : 700) : undefined,
                    fontWeight: fontsLoaded ? undefined : '700',
                  },
                ]}>{captionText}</Text>
              </View>
            )}
          </View>
          <View style={styles.previewTopRow}>
            {!!activeFilter && activeFilter !== 'original' ? <Text style={styles.previewBadge}>{activeFilter.replace('_', ' ')}</Text> : <View />}
            <Text style={styles.previewCounter}>{activeClip ? `${playing ? 'FULL REEL' : 'REEL'} · SHOT ${Math.max(0, orderedClips.indexOf(activeClip)) + 1} / ${orderedClips.length}` : 'REEL PREVIEW'}</Text>
          </View>
          {captionPositionMode ? (
            <Pressable style={styles.captionPositionPill} onPress={() => setCaptionPositionMode(false)}>
              <Ionicons name="move" size={14} color="#fff" /><Text style={styles.captionPositionText}>Drag caption · Done</Text>
            </Pressable>
          ) : null}
          {!!rendering && (
            <View style={styles.renderingPill}>
              <Animated.View style={{ transform: [{ rotate: spin }] }}><Ionicons name="sync" size={16} color="#fff" /></Animated.View>
              <Text style={styles.renderingText}>{renderStage || 'Preparing video…'}</Text>
            </View>
          )}
        </View>

        <View style={styles.transport}>
          <Pressable style={styles.roundControl} onPress={togglePlayback} accessibilityLabel={playing ? 'Pause preview' : 'Play preview'}>
            <Ionicons name={playing ? 'pause' : 'play'} size={21} color="#fff" />
          </Pressable>
          <Text style={styles.timecode}>{clock(timelinePosition)}<Text style={styles.timeDivider}> / </Text>{clock(fullTimelineDuration)}</Text>
          <Pressable style={styles.fullReelButton} onPress={playFullReel} accessibilityLabel="Play full reel from the beginning">
            <Ionicons name="play" size={12} color="#fff" /><Text style={styles.fullReelButtonText}>Full reel</Text>
          </Pressable>
          <Pressable style={styles.roundControl} onPress={undo} disabled={!historyBack.current.length} accessibilityLabel="Undo edit">
            <Ionicons name="arrow-undo" size={19} color={historyBack.current.length ? '#fff' : '#686A72'} />
          </Pressable>
          <Pressable style={styles.roundControl} onPress={redo} disabled={!historyForward.current.length} accessibilityLabel="Redo edit">
            <Ionicons name="arrow-redo" size={19} color={historyForward.current.length ? '#fff' : '#686A72'} />
          </Pressable>
        </View>

        <View style={styles.timeline} onLayout={(event) => setTimelineWidth(event.nativeEvent.layout.width)}>
          <View style={styles.ruler}>
            <Text style={styles.rulerDot}>•</Text><Text style={styles.rulerTime}>0s</Text>
            <Text style={styles.rulerDot}>•</Text><Text style={styles.rulerTime}>{Math.max(1, Math.round(estimatedDuration / 2))}s</Text>
            <Text style={styles.rulerDot}>•</Text><Text style={styles.rulerTime}>{Math.ceil(estimatedDuration)}s</Text>
          </View>
          <View style={styles.clipTrack}>
            {orderedClips.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clipStrip}>
                {orderedSegments.map((segment: any, index: number) => {
                  const { clip, shot, start, part, id: segmentId } = segment;
                  const duration = Math.max(0.5, Number(clip.duration_seconds) || 5);
                  const edit = editForShot(settings, shot);
                  const selected = shot === activeShot && segmentId === activeSegment?.id;
                  return (
                    <TimelineClip
                      key={segmentId}
                      clip={clip}
                      shot={shot}
                      duration={duration}
                      edit={edit}
                      selected={selected}
                      segmentLabel={`${shot + 1}${String.fromCharCode(97 + part)}`}
                      onSelect={() => selectClip(shot, start)}
                      onTrim={(values) => updateClip(shot, values)}
                    />
                  );
                })}
                <Pressable style={styles.addClip} onPress={() => void addClip()} disabled={addingClip} accessibilityLabel="Add or record another clip">
                  {addingClip ? <ActivityIndicator color="#101114" /> : <Ionicons name="add" size={30} color="#101114" />}
                </Pressable>
              </ScrollView>
            ) : (
              <Pressable style={styles.emptyTimeline} onPress={() => void addClip()}>
                <Ionicons name="videocam-outline" size={20} color="#fff" /><Text style={styles.emptyTimelineText}>Record your first clip</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.captionTrackHeader}>
            <Ionicons name="images-outline" size={15} color="#B9BBC3" />
            <Text style={styles.captionTrackTitle}>B-ROLL</Text>
            <Text style={styles.trackTag}>Overlays · {brollItems.length}</Text>
          </View>
          <View style={styles.captionTrack}>
            {brollItems.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.captionStrip}>
              {brollItems.map((item) => <Pressable key={item.id} onPress={() => { setSelectedBroll(item.id); openTool('Overlay'); }} style={[styles.brollTimelineItem, selectedBroll === item.id && styles.choiceOn]}>
                {item.signed_url ? <Image source={{ uri: item.signed_url }} contentFit="cover" style={styles.brollTimelineImage} /> : null}
                <Text style={styles.brollTimelineText} numberOfLines={1}>{Math.floor(item.start)}s · {Math.ceil(item.duration)}s</Text>
              </Pressable>)}
            </ScrollView> : <Pressable style={styles.emptyBrollTrack} onPress={() => openTool('Overlay')}><Ionicons name="add" size={16} color="#D6D7DC" /><Text style={styles.trackPlaceholder}>Tap Overlay to add B-roll</Text></Pressable>}
          </View>
          <View style={styles.captionTrackHeader}>
            <Ionicons name="chatbox-ellipses-outline" size={15} color="#B9BBC3" />
            <Text style={styles.captionTrackTitle}>CAPTION TIMING</Text>
            <Text style={styles.trackTag}>Tap a segment to edit</Text>
          </View>
          <View style={styles.captionTrack}>
            {orderedClips.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.captionStrip}>
                {orderedClips.map((clip: any, index: number) => {
                  const shot = shotIndex(clip, index);
                  const duration = Math.max(0.5, Number(clip.duration_seconds) || 5);
                  const edit = editForShot(settings, shot);
                  const caption = settings.caption_edits.find((item) => item.shot_index === shot)
                    || { shot_index: shot, start_seconds: 0, end_seconds: Math.max(0.25, (edit.trim_end_seconds - edit.trim_start_seconds) / edit.playback_rate), position_x: 50, position_y: 84, size: 'medium', font: 'sans' };
                  return (
                    <TimelineCaption
                      key={`caption-${shot}`}
                      duration={duration}
                      edit={edit}
                      caption={caption}
                      text={project?.storyboard?.[shot]?.on_screen_text || ''}
                      selected={shot === activeShot}
                      enabled={settings.captions_enabled}
                      onTiming={(values, record) => updateCaption(shot, values, record)}
                      onTimingStart={() => pushHistory(settingsRef.current)}
                      onSelect={() => { selectClip(shot); openTool('Captions'); }}
                    />
                  );
                })}
              </ScrollView>
            ) : <Text style={styles.captionTrackEmpty}>Caption timing will appear after you add clips</Text>}
          </View>
          <Pressable style={styles.trackRow} onPress={() => openTool('Audio')} accessibilityLabel="Edit music track">
            <Ionicons name="musical-notes" size={17} color="#B9BBC3" />
            <Text style={styles.trackPlaceholder} numberOfLines={1}>{project?.soundtrack?.title || 'Tap to add music'}</Text>
            {!!project?.soundtrack?.title && <Text style={styles.trackTag}>MUSIC</Text>}
          </Pressable>
          <Pressable style={styles.trackRow} onPress={() => openTool('Voice')} accessibilityLabel="Edit voiceover track">
            <Ionicons name="mic-outline" size={17} color="#B9BBC3" />
            <Text style={styles.trackPlaceholder} numberOfLines={1}>{project?.voiceover?.title || 'Tap to add voiceover'}</Text>
            {!!project?.voiceover?.title && <Text style={styles.trackTag}>VOICE</Text>}
          </Pressable>
          <Pressable style={styles.trackRow} onPress={() => openTool('Text')} accessibilityLabel="Edit title text track">
            <Text style={styles.trackAa}>Aa</Text>
            <Text style={styles.trackPlaceholder} numberOfLines={1}>{settings.title_text || 'Tap to add text'}</Text>
            {!!settings.title_text && <Text style={styles.trackTag}>TITLE</Text>}
          </Pressable>
          {orderedClips.length ? (
            <>
              <View pointerEvents="none" style={[styles.playhead, { left: `${playheadPercent}%` }]} />
              <View
                {...timelinePanResponder.panHandlers}
                style={[styles.playheadDragTarget, { left: `${playheadPercent}%` }]}
                accessibilityRole="adjustable"
                accessibilityLabel="Drag to scrub through the full reel"
              />
            </>
          ) : null}
          <Text style={styles.timelineHint}>Drag the white line to scrub · Tap a caption segment to set its timing</Text>
        </View>

        {(!!renderError || !!addClipError) ? <Text style={styles.inlineError} accessibilityRole="alert">{renderError || addClipError}</Text> : null}
        {!!notice && !dirty ? <Text style={styles.notice}>{notice}</Text> : null}
        {!!project && orderedClips.length > 0 ? <Text style={styles.summary}>{includedCount} clips · {estimatedDuration.toFixed(1)} sec · {settings.resolution} export</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.toolsSafe}>
        <View style={styles.toolBar}>
          {TOOL_ITEMS.map((item) => (
            <Pressable key={item.name} style={styles.toolButton} onPress={() => openTool(item.name as ToolName)} accessibilityRole="button" accessibilityLabel={`${item.name} editing tool`}>
              <Ionicons name={item.icon as any} size={24} color="#fff" />
              <Text style={styles.toolLabel}>{item.name}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>

      <ToolSheet visible={!!tool} title={tool || ''} onClose={() => { setTool(null); setToolError(''); }}>
        {tool === 'Audio' ? (
          <>
            <Text style={styles.sheetDescription}>{project?.soundtrack?.title ? 'Your music stays separate from the voiceover. Adjust its level or replace the track.' : 'Add a song or ambient music. Your voiceover can be added separately.'}</Text>
            <View style={styles.audioTrackCard}>
              <View style={styles.audioIcon}><Ionicons name="musical-notes" size={21} color="#fff" /></View>
              <View style={{ flex: 1 }}><Text style={styles.audioTitle} numberOfLines={1}>{project?.soundtrack?.title || 'No music added yet'}</Text><Text style={styles.audioMeta}>{project?.soundtrack?.title ? 'Music track · mixed with voiceover' : 'Choose an audio file from your device'}</Text></View>
              {project?.soundtrack?.storage_path ? <Pressable onPress={removeAudio} style={styles.smallIconButton} accessibilityLabel="Remove audio"><Ionicons name="trash-outline" size={18} color="#F87171" /></Pressable> : null}
            </View>
            <ActionButton icon="folder-open-outline" label={project?.soundtrack?.title ? 'Replace music' : 'Choose music'} onPress={() => void chooseAudio()} loading={audioBusy} />
            {project?.soundtrack?.storage_path ? (
              <>
                <ActionButton icon="musical-note-outline" label="Sync cuts to music beats" onPress={() => void syncToMusicBeats()} loading={beatSyncing} />
                <Text style={styles.sheetFootnote}>Optional: preview the suggested cut timing, adjust it, or undo. Nothing is applied to your source clips.</Text>
              </>
            ) : <Text style={styles.sheetFootnote}>Add a music track to see the optional beat-sync suggestion.</Text>}
            <Text style={styles.rowLabel}>MUSIC VOLUME · {settings.music_volume}%</Text>
            <VolumeControl value={settings.music_volume} onChange={(value) => update('music_volume', value)} />
            <Text style={styles.rowLabel}>CLIP SOUND · {settings.original_volume}%</Text>
            <VolumeControl value={settings.original_volume} onChange={(value) => update('original_volume', value)} />
            <Text style={styles.sheetFootnote}>Music and voiceover are saved and mixed as separate tracks.</Text>
          </>
        ) : null}

        {tool === 'Text' ? (
          <>
            <Text style={styles.sheetDescription}>Add a title that appears in the preview and finished video.</Text>
            <TextInput value={settings.title_text} onChangeText={(value) => update('title_text', value)} placeholder="Write your title" placeholderTextColor="#747780" maxLength={80} style={styles.titleInput} accessibilityLabel="Video title text" />
            <Text style={styles.characterCount}>{settings.title_text.length}/80</Text>
            <Text style={styles.rowLabel}>ONE-TAP STYLE</Text>
            <View style={styles.choiceGrid}>{TEXT_STYLES.map((preset) => <Choice key={preset.id} label={preset.label} active={settings.title_style_id === preset.id} onPress={() => applyTextStyle(preset.id)} />)}</View>
            <Text style={styles.rowLabel}>FONT</Text>
            <ChoiceRow options={CAPTION_FONTS as string[][]} selected={settings.title_font} onSelect={(value) => update('title_font', value)} />
            <Text style={styles.rowLabel}>POSITION</Text>
            <ChoiceRow options={['top', 'center', 'bottom'].map((value) => [value, value])} selected={settings.title_position} onSelect={(value) => update('title_position', value)} />
            <Text style={styles.rowLabel}>SIZE</Text>
            <ChoiceRow options={['small', 'medium', 'large'].map((value) => [value, value])} selected={settings.title_size} onSelect={(value) => update('title_size', value)} />
            <Text style={styles.rowLabel}>COLOR</Text>
            <ChoiceRow options={['white', 'gold', 'pink', 'black'].map((value) => [value, value])} selected={settings.title_color} onSelect={(value) => update('title_color', value)} />
            <Text style={styles.rowLabel}>ANIMATION</Text>
            <ChoiceRow options={[
              ['none', 'None'], ['fade', 'Fade'], ['pop', 'Pop'], ['slide-up', 'Slide up'],
              ['typewriter', 'Typewriter'], ['word-by-word', 'Word by word'],
            ]} selected={settings.title_animation} onSelect={(value) => update('title_animation', value)} />
          </>
        ) : null}

        {tool === 'Voice' ? (
          <>
            <Text style={styles.sheetDescription}>Record narration with your phone microphone. It is mixed separately with your music and clip audio.</Text>
            <View style={styles.audioTrackCard}>
              <View style={styles.audioIcon}><Ionicons name="mic" size={21} color="#fff" /></View>
              <View style={{ flex: 1 }}><Text style={styles.audioTitle} numberOfLines={1}>{project?.voiceover?.title || 'No voiceover added yet'}</Text><Text style={styles.audioMeta}>{project?.voiceover?.title ? 'Voiceover track · starts at the beginning' : 'Record narration with your device microphone'}</Text></View>
              {project?.voiceover?.storage_path ? <Pressable onPress={removeVoiceover} style={styles.smallIconButton} accessibilityLabel="Remove voiceover"><Ionicons name="trash-outline" size={18} color="#F87171" /></Pressable> : null}
            </View>
            <View style={styles.voiceCard}>
              <View style={[styles.voicePulse, recordingVoice && styles.voicePulseRecording]}><Ionicons name={recordingVoice ? 'mic' : 'mic-outline'} size={28} color="#fff" /></View>
              <Text style={styles.voiceTitle}>{recordingVoice ? 'Recording your voice…' : 'Record a voiceover'}</Text>
              <Text style={styles.voiceHint}>{recordingVoice ? 'Tap stop when you are done.' : 'Find a quiet place, then tap below to start.'}</Text>
            </View>
            <Pressable style={[styles.recordButton, recordingVoice && styles.stopRecordButton]} onPress={() => void (recordingVoice ? stopVoiceRecording() : startVoiceRecording())} disabled={audioBusy}>
              {audioBusy ? <ActivityIndicator color="#fff" /> : <Ionicons name={recordingVoice ? 'stop' : 'mic'} size={19} color="#fff" />}
              <Text style={styles.recordButtonText}>{audioBusy ? 'Saving recording…' : recordingVoice ? 'Stop and add voiceover' : 'Start recording'}</Text>
            </Pressable>
            <ActionButton icon="folder-open-outline" label="Import a voice recording" onPress={() => void chooseVoiceover()} loading={audioBusy || recordingVoice} />
            <Text style={styles.rowLabel}>VOICEOVER VOLUME · {settings.voiceover_volume}%</Text>
            <VolumeControl value={settings.voiceover_volume} onChange={(value) => update('voiceover_volume', value)} />
            <Text style={styles.sheetFootnote}>Your music track stays in place when you record or remove the voiceover.</Text>
          </>
        ) : null}

        {tool === 'Captions' ? (
          <>
            <Text style={styles.sheetDescription}>Place and style this shot’s caption, then set when it appears in the trimmed clip. It is included in the finished video.</Text>
            <Pressable style={styles.toggleRow} onPress={() => update('captions_enabled', !settings.captions_enabled)}>
              <View style={{ flex: 1 }}><Text style={styles.toggleTitle}>Captions</Text><Text style={styles.toggleHint}>{settings.captions_enabled ? 'Included in the preview and export' : 'Off for this reel'}</Text></View>
              <View style={[styles.toggle, settings.captions_enabled && styles.toggleOn]}><View style={[styles.toggleKnob, settings.captions_enabled && styles.toggleKnobOn]} /></View>
            </Pressable>
            {captionText ? <View style={styles.captionSample}><Text style={styles.captionSampleLabel}>CURRENT CLIP</Text><Text style={styles.captionSampleText}>{captionText}</Text></View> : <View style={styles.captionSample}><Text style={styles.captionSampleLabel}>CURRENT CLIP</Text><Text style={styles.captionSampleTextMuted}>No caption text was added to this shot plan.</Text></View>}
            {!!captionText && <ActionButton icon="move-outline" label="Position caption on preview" onPress={() => {
              if (!settings.captions_enabled) update('captions_enabled', true);
              setTool(null);
              setCaptionPositionMode(true);
              requestAnimationFrame(() => editorScrollRef.current?.scrollTo({ y: 0, animated: true }));
            }} />}
            {!!captionText && (
              <>
                <Text style={styles.rowLabel}>CAPTION TIMING · WITHIN THIS TRIMMED CLIP</Text>
                <View style={styles.captionTimingRow}>
                  <TrimControl label="IN" value={activeCaption.start_seconds} onMinus={() => adjustCaptionTime('start_seconds', -0.25)} onPlus={() => adjustCaptionTime('start_seconds', 0.25)} />
                  <View style={styles.captionTimingDivider} />
                  <TrimControl label="OUT" value={activeCaption.end_seconds} onMinus={() => adjustCaptionTime('end_seconds', -0.25)} onPlus={() => adjustCaptionTime('end_seconds', 0.25)} />
                </View>
                <Text style={styles.rowLabel}>CAPTION SIZE</Text>
                <ChoiceRow options={['small', 'medium', 'large'].map((value) => [value, value])} selected={activeCaption.size} onSelect={(value) => updateCaption(activeShot, { size: value })} />
                <Text style={styles.rowLabel}>CAPTION FONT</Text>
                <ChoiceRow options={CAPTION_FONTS as string[][]} selected={activeCaption.font} onSelect={(value) => updateCaption(activeShot, { font: value })} />
              </>
            )}
          </>
        ) : null}

        {tool === 'Overlay' ? (
          <>
            <Text style={styles.sheetDescription}>Add a picture-in-picture B-roll image and set the finished reel framing.</Text>
            <ActionButton icon="images-outline" label="Add B-roll image" onPress={() => void chooseBrollImage()} loading={audioBusy} />
            {selectedBroll ? <ActionButton icon="trash-outline" label="Remove selected B-roll" onPress={() => void removeSelectedBroll()} loading={audioBusy} /> : null}
            <Text style={styles.sheetFootnote}>{brollItems.length ? 'The selected B-roll appears on its own timeline row.' : 'Choose an image; it will appear for 3 seconds at the playhead.'}</Text>
            <Text style={styles.rowLabel}>TITLE PLACEMENT</Text>
            <ChoiceRow options={['top', 'center', 'bottom'].map((value) => [value, value])} selected={settings.title_position} onSelect={(value) => update('title_position', value)} />
            <Text style={styles.rowLabel}>VIDEO SHAPE</Text>
            <ChoiceRow options={[[ '9:16', 'Reel · 9:16' ], ['1:1', 'Square'], ['16:9', 'Landscape']]} selected={settings.aspect_ratio} onSelect={(value) => update('aspect_ratio', value)} />
            <Text style={styles.rowLabel}>FILL THE FRAME</Text>
            <ChoiceRow options={[[ 'fill', 'Fill' ], ['fit', 'Fit whole clip']]} selected={settings.fit_mode} onSelect={(value) => update('fit_mode', value)} />
          </>
        ) : null}

        {tool === 'Filter' ? (
          <>
            <Text style={styles.sheetDescription}>Let AI shape a first cut from your shot plan and saved shot reviews, then preview it and adjust anything.</Text>
            <Text style={styles.rowLabel}>AI PACING · {settings.pacing.toUpperCase()}</Text>
            <ChoiceRow options={[[ 'relaxed', 'Relaxed' ], [ 'balanced', 'Balanced' ], [ 'fast', 'Fast' ]]} selected={settings.pacing} onSelect={(value) => update('pacing', value as EditorSettings['pacing'])} />
            <ActionButton icon="sparkles-outline" label="Make my reel" onPress={() => void makeMyReel()} loading={autoEditing} />
            {!!toolError && <Text style={styles.inlineError} accessibilityRole="alert">{toolError}</Text>}
            <Text style={styles.sheetDescription}>Choose a look for the whole reel or a filter for just this clip.</Text>
            <Text style={styles.rowLabel}>WHOLE REEL LOOK</Text>
            <View style={styles.choiceGrid}>{LOOKS.map((look) => <Choice key={look.id} label={look.label} active={settings.editing_style === look.id} onPress={() => update('editing_style', look.id)} />)}</View>
            {!!activeEdit && (
              <>
                <Text style={styles.rowLabel}>SELECTED CLIP · {Math.max(0, orderedClips.findIndex((clip: any) => shotIndex(clip, -1) === activeShot)) + 1}</Text>
                <Text style={styles.rowLabel}>SPEED</Text>
                <ChoiceRow options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => [String(rate), `${rate}×`] as string[])} selected={String(activeEdit.playback_rate)} onSelect={(value) => updateClip(activeShot, { playback_rate: Number(value) })} />
                <Pressable style={styles.actionButton} onPress={splitAtPlayhead} accessibilityRole="button" accessibilityLabel="Split clip at playhead">
                  <Ionicons name="cut-outline" size={18} color="#fff" /><Text style={styles.actionButtonText}>Split at playhead</Text>
                </Pressable>
                <View style={styles.choiceGrid}>{CLIP_FILTERS.map((filter) => <Choice key={filter.id} label={filter.label} active={activeEdit.filter_preset === filter.id} onPress={() => updateClip(activeShot, { filter_preset: filter.id })} />)}</View>
                {Platform.OS !== 'web' ? <Text style={styles.sheetFootnote}>Your device shows a simplified filter preview. The exported video applies the full effect.</Text> : null}
                <View style={styles.trimSection}>
                  <View style={{ flex: 1 }}><Text style={styles.trimHeading}>Clip brightness</Text><Text style={styles.trimValueText}>{Math.round(activeEdit.brightness * 100)}%</Text></View>
                  <Pressable style={styles.smallIconButton} onPress={() => updateClip(activeShot, { brightness: Math.max(-0.5, Math.round((activeEdit.brightness - 0.05) * 100) / 100) })} accessibilityLabel="Lower brightness"><Ionicons name="remove" size={19} color="#fff" /></Pressable>
                  <Pressable style={styles.smallIconButton} onPress={() => updateClip(activeShot, { brightness: Math.min(0.5, Math.round((activeEdit.brightness + 0.05) * 100) / 100) })} accessibilityLabel="Raise brightness"><Ionicons name="add" size={19} color="#fff" /></Pressable>
                </View>
                <View style={styles.reorderRow}>
                  <Text style={styles.trimHeading}>Clip order</Text>
                  <Pressable style={styles.reorderButton} onPress={() => moveClip(activeShot, -1)} disabled={orderedClips.findIndex((clip: any) => shotIndex(clip, -1) === activeShot) === 0}>
                    <Ionicons name="arrow-back" size={15} color="#fff" /><Text style={styles.reorderText}>Earlier</Text>
                  </Pressable>
                  <Pressable style={styles.reorderButton} onPress={() => moveClip(activeShot, 1)} disabled={orderedClips.findIndex((clip: any) => shotIndex(clip, -1) === activeShot) === orderedClips.length - 1}>
                    <Text style={styles.reorderText}>Later</Text><Ionicons name="arrow-forward" size={15} color="#fff" />
                  </Pressable>
                </View>
                <View style={styles.trimSection}>
                  <Text style={styles.trimHeading}>Trim clip</Text>
                  <TrimControl label="IN" value={activeEdit.trim_start_seconds} onMinus={() => adjustTrim(activeShot, 'in', -0.5, Number(activeClip.duration_seconds) || 5)} onPlus={() => adjustTrim(activeShot, 'in', 0.5, Number(activeClip.duration_seconds) || 5)} />
                  <TrimControl label="OUT" value={activeEdit.trim_end_seconds} onMinus={() => adjustTrim(activeShot, 'out', -0.5, Number(activeClip.duration_seconds) || 5)} onPlus={() => adjustTrim(activeShot, 'out', 0.5, Number(activeClip.duration_seconds) || 5)} />
                </View>
                <Pressable style={styles.excludeRow} onPress={() => updateClip(activeShot, { included: !activeEdit.included })} accessibilityRole="button">
                  <Ionicons name={activeEdit.included ? 'checkmark-circle-outline' : 'add-circle-outline'} size={20} color={activeEdit.included ? '#fff' : theme.color.brand} />
                  <Text style={styles.excludeText}>{activeEdit.included ? 'Remove this clip from the reel' : 'Restore this clip to the reel'}</Text>
                </Pressable>
                <ActionButton icon="refresh-outline" label="Retake this shot" onPress={() => void retakeClip()} loading={retakingClip} />
              </>
            )}
          </>
        ) : null}

        {tool === 'Export settings' ? (
          <>
            <Text style={styles.sheetDescription}>Choose a format before exporting your reel.</Text>
            <Text style={styles.rowLabel}>RENDER ENGINE</Text>
            <ChoiceRow options={[['ffmpeg', 'Built-in renderer'], ['creatomate', 'Creatomate (optional)']]} selected={settings.render_provider} onSelect={(value) => update('render_provider', value as EditorSettings['render_provider'])} />
            <Text style={styles.rowLabel}>VIDEO SHAPE</Text>
            <ChoiceRow options={[[ '9:16', 'Reels / Shorts' ], ['1:1', 'Square'], ['16:9', 'YouTube']]} selected={settings.aspect_ratio} onSelect={(value) => update('aspect_ratio', value)} />
            <Text style={styles.rowLabel}>RESOLUTION</Text>
            <ChoiceRow options={['720p', '1080p'].map((value) => [value, value])} selected={settings.resolution} onSelect={(value) => update('resolution', value)} />
            <Text style={styles.rowLabel}>FRAME RATE</Text>
            <ChoiceRow options={['24', '30', '60'].map((value) => [value, `${value} fps`])} selected={String(settings.fps)} onSelect={(value) => update('fps', Number(value))} />
            <View style={styles.exportSummary}><Text style={styles.exportSummaryText}>{includedCount} clips · {estimatedDuration.toFixed(1)} sec · {settings.resolution} · {settings.fps} fps</Text></View>
            <ActionButton icon="download-outline" label="Render upload-ready video" onPress={() => void render()} loading={rendering} />
          </>
        ) : null}
        {!!toolError && <Text style={styles.inlineError} accessibilityRole="alert">{toolError}</Text>}
      </ToolSheet>
    </View>
  );
}

function editForShot(settings: EditorSettings, shot: number): ClipEdit {
  return settings.clip_edits.find((edit) => edit.shot_index === shot)
    || { shot_index: shot, included: true, trim_start_seconds: 0, trim_end_seconds: 5, filter_preset: 'original', brightness: 0, playback_rate: 1 };
}

function nativeTint(clipFilter: string, look: string) {
  const selected = clipFilter !== 'original' ? clipFilter : look;
  const tints: Record<string, string> = {
    warm: 'rgba(233,139,65,0.15)', cool: 'rgba(62,129,220,0.15)', vintage: 'rgba(185,139,78,0.17)', film: 'rgba(125,92,58,0.10)',
    soft: 'rgba(255,255,255,0.08)', luxury: 'rgba(38,24,13,0.15)', mono: 'rgba(255,255,255,0.14)', vivid: 'rgba(224,17,95,0.08)',
  };
  return tints[selected] || 'transparent';
}

const TOOL_ITEMS = [
  { name: 'Audio', icon: 'musical-notes-outline' }, { name: 'Text', icon: 'text-outline' },
  { name: 'Voice', icon: 'mic-outline' }, { name: 'Captions', icon: 'chatbox-ellipses-outline' },
  { name: 'Overlay', icon: 'layers-outline' }, { name: 'Filter', icon: 'color-filter-outline' },
];

function ToolSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close editing tool" />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{title}</Text><Pressable style={styles.sheetClose} onPress={onClose} accessibilityLabel="Close"><Ionicons name="close" size={22} color="#fff" /></Pressable></View>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function TimelineClip({ clip, shot, duration, edit, selected, segmentLabel, onSelect, onTrim }: {
  clip: any; shot: number; duration: number; edit: ClipEdit; selected: boolean; segmentLabel: string;
  onSelect: () => void; onTrim: (values: Partial<ClipEdit>) => void;
}) {
  const width = Math.min(220, Math.max(96, duration / edit.playback_rate * 26));
  const liveEdit = useRef(edit);
  const trimCallback = useRef(onTrim);
  liveEdit.current = edit;
  trimCallback.current = onTrim;
  const base = useRef({ start: edit.trim_start_seconds, end: edit.trim_end_seconds });
  const leftPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 2,
    onPanResponderGrant: () => { base.current = { start: liveEdit.current.trim_start_seconds, end: liveEdit.current.trim_end_seconds }; },
    onPanResponderMove: (_event, gesture) => {
      const next = Math.max(0, Math.min(base.current.end - 0.25, base.current.start + gesture.dx / Math.max(1, width / duration)));
      trimCallback.current({ trim_start_seconds: Math.round(next * 10) / 10 });
    },
    onPanResponderTerminationRequest: () => false,
  })).current;
  const rightPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 2,
    onPanResponderGrant: () => { base.current = { start: liveEdit.current.trim_start_seconds, end: liveEdit.current.trim_end_seconds }; },
    onPanResponderMove: (_event, gesture) => {
      const next = Math.max(base.current.start + 0.25, Math.min(duration, base.current.end + gesture.dx / Math.max(1, width / duration)));
      trimCallback.current({ trim_end_seconds: Math.round(next * 10) / 10 });
    },
    onPanResponderTerminationRequest: () => false,
  })).current;
  const leftPercent = Math.max(0, Math.min(1, edit.trim_start_seconds / duration));
  const rightPercent = Math.max(0, Math.min(1, (duration - edit.trim_end_seconds) / duration));

  return (
    <Pressable onPress={onSelect} style={[styles.clipCell, { width, opacity: edit.included ? 1 : 0.46 }, selected && styles.clipCellSelected]} accessibilityLabel={`Select clip ${shot + 1}`}>
      {clip.frame_url ? <Image source={{ uri: clip.frame_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={[StyleSheet.absoluteFill, styles.clipCellFallback]}><Ionicons name="videocam" size={20} color="#fff" /></View>}
      <View pointerEvents="none" style={[styles.trimMask, { left: 0, width: `${leftPercent * 100}%` }]} />
      <View pointerEvents="none" style={[styles.trimMask, { right: 0, width: `${rightPercent * 100}%` }]} />
      {selected ? <View pointerEvents="none" style={[styles.selectedTrim, { left: `${leftPercent * 100}%`, right: `${rightPercent * 100}%` }]} /> : null}
      <View style={styles.clipCellBadge}><Text style={styles.clipCellBadgeText}>{segmentLabel}</Text></View>
      {selected ? (
        <>
          <View {...leftPan.panHandlers} style={[styles.trimHandle, styles.trimHandleLeft, { left: `${leftPercent * 100}%` }]} accessibilityLabel="Drag to trim the start of this clip"><View style={styles.trimGrip} /></View>
          <View {...rightPan.panHandlers} style={[styles.trimHandle, styles.trimHandleRight, { right: `${rightPercent * 100}%` }]} accessibilityLabel="Drag to trim the end of this clip"><View style={styles.trimGrip} /></View>
        </>
      ) : null}
    </Pressable>
  );
}

function TimelineCaption({ duration, edit, caption, text, selected, enabled, onTiming, onTimingStart, onSelect }: {
  duration: number; edit: ClipEdit; caption: CaptionEdit; text: string; selected: boolean; enabled: boolean;
  onTiming: (values: Partial<CaptionEdit>, recordHistory?: boolean) => void; onTimingStart: () => void; onSelect: () => void;
}) {
  const timelineDuration = duration / edit.playback_rate;
  const width = Math.min(220, Math.max(96, duration / edit.playback_rate * 26));
  const clipWindow = Math.max(0.25, (edit.trim_end_seconds - edit.trim_start_seconds) / edit.playback_rate);
  const left = Math.max(0, Math.min(width - 4, (edit.trim_start_seconds + caption.start_seconds * edit.playback_rate) / duration * width));
  const right = Math.max(left + 4, Math.min(width, (edit.trim_start_seconds + caption.end_seconds * edit.playback_rate) / duration * width));
  const captionRef = useRef(caption);
  const metricsRef = useRef({ width, duration: timelineDuration, clipWindow });
  const timingRef = useRef(onTiming);
  const timingStartRef = useRef(onTimingStart);
  const dragBase = useRef({ start: caption.start_seconds, end: caption.end_seconds });
  captionRef.current = caption;
  metricsRef.current = { width, duration: timelineDuration, clipWindow };
  timingRef.current = onTiming;
  timingStartRef.current = onTimingStart;
  const startHandle = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 1,
    onPanResponderGrant: () => {
      dragBase.current = { start: captionRef.current.start_seconds, end: captionRef.current.end_seconds };
      timingStartRef.current();
    },
    onPanResponderMove: (_event, gesture) => {
      const metrics = metricsRef.current;
      const change = gesture.dx * metrics.duration / Math.max(1, metrics.width);
      const start = Math.max(0, Math.min(dragBase.current.end - 0.15, dragBase.current.start + change));
      timingRef.current({ start_seconds: Math.round(start * 10) / 10 }, false);
    },
    onPanResponderTerminationRequest: () => false,
  })).current;
  const endHandle = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 1,
    onPanResponderGrant: () => {
      dragBase.current = { start: captionRef.current.start_seconds, end: captionRef.current.end_seconds };
      timingStartRef.current();
    },
    onPanResponderMove: (_event, gesture) => {
      const metrics = metricsRef.current;
      const change = gesture.dx * metrics.duration / Math.max(1, metrics.width);
      const end = Math.max(dragBase.current.start + 0.15, Math.min(metrics.clipWindow, dragBase.current.end + change));
      timingRef.current({ end_seconds: Math.round(end * 10) / 10 }, false);
    },
    onPanResponderTerminationRequest: () => false,
  })).current;
  return (
    <Pressable
      onPress={onSelect}
      style={[styles.captionTimelineCell, { width, opacity: enabled && edit.included ? 1 : 0.45 }, selected && styles.captionTimelineCellSelected]}
      accessibilityRole="button"
      accessibilityLabel={text ? `Edit caption timing, ${caption.start_seconds.toFixed(1)} to ${caption.end_seconds.toFixed(1)} seconds` : 'Add caption text for this clip'}
    >
      <View style={styles.captionTimelineBase} />
      {!!text && <View style={[styles.captionTimelineSegment, { left, width: Math.max(4, right - left) }]}>
        <View {...startHandle.panHandlers} style={styles.captionTimelineHandle} accessibilityLabel="Drag to change caption start time" />
        <Text pointerEvents="none" numberOfLines={1} style={styles.captionTimelineText}>{text}</Text>
        <View {...endHandle.panHandlers} style={styles.captionTimelineHandle} accessibilityLabel="Drag to change caption end time" />
      </View>}
      {!text && <Text style={styles.captionNoText}>No caption</Text>}
      {selected && !!text && <Text style={styles.captionTimelineRange}>{caption.start_seconds.toFixed(1)}–{caption.end_seconds.toFixed(1)}s</Text>}
    </Pressable>
  );
}

function VolumeControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.volumeRow}>
      <Pressable style={styles.volumeButton} onPress={() => onChange(Math.max(0, value - 10))} accessibilityLabel="Lower audio volume"><Ionicons name="remove" size={18} color="#fff" /></Pressable>
      <View style={styles.volumeBar}><View style={[styles.volumeFill, { width: `${value}%` }]} /></View>
      <Pressable style={styles.volumeButton} onPress={() => onChange(Math.min(100, value + 10))} accessibilityLabel="Raise audio volume"><Ionicons name="add" size={18} color="#fff" /></Pressable>
      <Text style={styles.volumeText}>{value}%</Text>
    </View>
  );
}

function TrimControl({ label, value, onMinus, onPlus }: { label: string; value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.trimControl}>
      <Text style={styles.trimLabel}>{label}</Text>
      <Pressable onPress={onMinus} style={styles.tinyButton} accessibilityLabel={`Move ${label} earlier`}><Ionicons name="remove" size={14} color="#fff" /></Pressable>
      <Text style={styles.trimValueText}>{value.toFixed(1)}s</Text>
      <Pressable onPress={onPlus} style={styles.tinyButton} accessibilityLabel={`Move ${label} later`}><Ionicons name="add" size={14} color="#fff" /></Pressable>
    </View>
  );
}

function ChoiceRow({ options, selected, onSelect }: { options: string[][]; selected: string; onSelect: (value: string) => void }) {
  return <View style={styles.choiceGrid}>{options.map(([value, label]) => <Choice key={value} label={label} active={selected === value} onPress={() => onSelect(value)} />)}</View>;
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceOn]}><Text style={[styles.choiceText, active && styles.choiceTextOn]}>{label}</Text></Pressable>;
}

function ActionButton({ icon, label, onPress, loading = false }: { icon: string; label: string; onPress: () => void; loading?: boolean }) {
  return <Pressable style={[styles.actionButton, loading && styles.buttonDisabled]} onPress={onPress} disabled={loading}>
    {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name={icon as any} size={18} color="#fff" />}<Text style={styles.actionButtonText}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050506' },
  safeTop: { backgroundColor: '#050506' },
  header: { minHeight: 49, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  headerIcon: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#F8F8FA', fontSize: 15, fontWeight: '700', maxWidth: '100%' },
  headerMeta: { color: '#858790', fontSize: 10, marginTop: 2 },
  exportButton: { minWidth: 70, height: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  exportButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  buttonDisabled: { opacity: 0.55 },
  editorScroll: { flex: 1 },
  editorBody: { paddingBottom: 8 },
  preview: { width: '100%', overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  previewMedia: { position: 'relative', overflow: 'hidden', backgroundColor: '#000' },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 11 },
  previewEmptyText: { color: '#A3A5AD', fontSize: 13 },
  previewTopRow: { position: 'absolute', left: 14, right: 14, top: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewBadge: { color: '#fff', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', backgroundColor: 'rgba(0,0,0,0.58)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  previewCounter: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.8, backgroundColor: 'rgba(0,0,0,0.52)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  titleOverlay: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  titleTop: { top: '14%' }, titleCenter: { top: '43%' }, titleBottom: { bottom: '15%' },
  previewTitle: { maxWidth: '94%', color: '#fff', fontWeight: '800', textAlign: 'center', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7, backgroundColor: 'rgba(0,0,0,0.4)', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  previewTitleDark: { backgroundColor: 'rgba(255,255,255,0.83)', textShadowColor: 'transparent' },
  captionOverlay: { position: 'absolute', alignItems: 'center', padding: 2 }, captionOverlayEditing: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.85)', borderRadius: 6 },
  captionText: { maxWidth: '100%', color: '#fff', backgroundColor: 'rgba(0,0,0,0.76)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, textAlign: 'center', fontSize: 15, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 2 },
  captionPositionPill: { position: 'absolute', bottom: 12, alignSelf: 'center', minHeight: 31, borderRadius: 18, paddingHorizontal: 12, backgroundColor: 'rgba(16,16,18,0.88)', flexDirection: 'row', alignItems: 'center', gap: 7 }, captionPositionText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  renderingPill: { position: 'absolute', bottom: 14, alignSelf: 'center', minHeight: 36, maxWidth: '88%', borderRadius: 18, paddingHorizontal: 12, backgroundColor: 'rgba(16,16,18,0.86)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  renderingText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  transport: { minHeight: 58, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: '#202126' },
  roundControl: { width: 39, height: 39, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1B1C21' },
  timecode: { color: '#F1F1F4', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginLeft: 7 },
  timeDivider: { color: '#777982' },
  transportSpacer: { flex: 1 },
  fullReelButton: { height: 34, borderRadius: 18, paddingHorizontal: 9, backgroundColor: '#292B32', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  fullReelButtonText: { color: '#F1F1F4', fontSize: 9, fontWeight: '700' },
  timeline: { paddingTop: 1, position: 'relative' },
  ruler: { height: 31, paddingHorizontal: 21, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#202126' },
  rulerDot: { color: '#858790', fontSize: 15 }, rulerTime: { color: '#9EA0A7', fontSize: 11, fontVariant: ['tabular-nums'] },
  clipTrack: { height: 94, position: 'relative', backgroundColor: '#191A1F', justifyContent: 'center' },
  clipStrip: { alignItems: 'center', paddingHorizontal: 8, gap: 3, height: '100%' },
  clipCell: { height: 80, overflow: 'hidden', borderRadius: 2, backgroundColor: '#292B32', borderWidth: 1, borderColor: 'transparent' },
  clipCellSelected: { borderColor: '#fff', borderWidth: 2 },
  clipCellFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#383A42' },
  trimMask: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)' },
  selectedTrim: { position: 'absolute', top: 0, bottom: 0, left: '18%', right: '18%', borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.07)' },
  trimHandle: { position: 'absolute', width: 18, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', zIndex: 4 },
  trimHandleLeft: { left: 0, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }, trimHandleRight: { right: 0, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  trimGrip: { width: 3, height: 19, borderRadius: 2, backgroundColor: '#24252A' },
  clipCellBadge: { position: 'absolute', left: 4, top: 4, borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 4, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  clipCellBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  captionTrackHeader: { height: 30, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#131418' },
  captionTrackTitle: { flex: 1, color: '#D5D6DC', fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  captionTrack: { height: 49, backgroundColor: '#202126', justifyContent: 'center' },
  captionStrip: { alignItems: 'center', paddingHorizontal: 8, gap: 3, height: '100%' },
  captionTimelineCell: { height: 37, borderRadius: 4, overflow: 'hidden', backgroundColor: '#292B32', justifyContent: 'center' },
  captionTimelineCellSelected: { borderWidth: 1, borderColor: '#F1F1F4' },
  captionTimelineBase: { ...StyleSheet.absoluteFillObject, backgroundColor: '#2A2C33' },
  captionTimelineSegment: { position: 'absolute', top: 6, bottom: 6, minWidth: 6, borderRadius: 3, justifyContent: 'center', overflow: 'hidden', flexDirection: 'row', alignItems: 'center', backgroundColor: '#9C2856' },
  captionTimelineHandle: { width: 11, height: '100%', backgroundColor: 'rgba(255,255,255,0.82)' },
  captionTimelineText: { flex: 1, color: '#fff', fontSize: 8, fontWeight: '700', textAlign: 'center' }, captionTimelineRange: { position: 'absolute', bottom: 1, right: 4, color: '#D1D2D8', fontSize: 7, fontVariant: ['tabular-nums'] },
  captionNoText: { color: '#858790', fontSize: 9, textAlign: 'center' }, captionTrackEmpty: { color: '#9C9EA5', textAlign: 'center', fontSize: 10 },
  captionTimingRow: { minHeight: 52, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#24262D', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, captionTimingDivider: { height: 24, width: 1, backgroundColor: '#41434A' },
  addClip: { width: 47, height: 47, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginHorizontal: 6 },
  playhead: { position: 'absolute', top: 33, height: 180, width: 2, marginLeft: -1, backgroundColor: '#fff', zIndex: 5 },
  playheadDragTarget: { position: 'absolute', top: 29, height: 188, width: 36, marginLeft: -18, backgroundColor: 'transparent', zIndex: 6 },
  emptyTimeline: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  emptyTimelineText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  trackRow: { height: 43, paddingHorizontal: 15, borderTopWidth: 1, borderColor: '#08090B', backgroundColor: '#1B1C21', flexDirection: 'row', alignItems: 'center', gap: 10 },
  trackPlaceholder: { color: '#9C9EA5', flex: 1, fontSize: 13, fontWeight: '600' }, trackAa: { width: 17, color: '#B9BBC3', fontSize: 14, fontWeight: '800' },
  trackTag: { color: '#81838C', fontSize: 9, letterSpacing: 0.6, fontWeight: '800' },
  timelineHint: { color: '#D8D9DD', textAlign: 'center', fontSize: 11, fontWeight: '600', paddingVertical: 9 },
  inlineError: { color: '#FF7979', textAlign: 'center', marginHorizontal: 18, marginVertical: 8, fontSize: 12, lineHeight: 17 },
  notice: { color: '#A8E8C5', textAlign: 'center', paddingTop: 5, fontSize: 11 },
  summary: { color: '#666973', textAlign: 'center', fontSize: 10, paddingTop: 6, paddingBottom: 2 },
  toolsSafe: { backgroundColor: '#050506', borderTopWidth: 1, borderTopColor: '#222329' },
  toolBar: { minHeight: 72, paddingHorizontal: 5, paddingTop: 9, paddingBottom: 3, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  toolButton: { flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 4 }, toolLabel: { color: '#F0F0F3', fontSize: 10, fontWeight: '600' },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { maxHeight: '77%', backgroundColor: '#17181D', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, overflow: 'hidden' },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 4, backgroundColor: '#60626A', marginBottom: 8 },
  sheetHeader: { minHeight: 49, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#2A2C33' },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '800' }, sheetClose: { width: 33, height: 33, borderRadius: 17, backgroundColor: '#292B32', alignItems: 'center', justifyContent: 'center' },
  sheetContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 26 },
  sheetDescription: { color: '#AEB0B8', lineHeight: 19, fontSize: 12, marginBottom: 14 },
  audioTrackCard: { minHeight: 66, padding: 10, marginBottom: 12, borderRadius: 12, backgroundColor: '#22242B', flexDirection: 'row', alignItems: 'center', gap: 10 },
  audioIcon: { width: 43, height: 43, borderRadius: 11, backgroundColor: '#53213A', alignItems: 'center', justifyContent: 'center' },
  audioTitle: { color: '#fff', fontSize: 13, fontWeight: '700' }, audioMeta: { color: '#90929A', fontSize: 10, marginTop: 3 },
  smallIconButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#30323A', alignItems: 'center', justifyContent: 'center' },
  actionButton: { minHeight: 46, backgroundColor: '#33353D', borderRadius: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginVertical: 5 }, actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  rowLabel: { color: '#92949D', fontSize: 10, fontWeight: '800', marginTop: 17, marginBottom: 6, letterSpacing: 0.7 },
  volumeRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9 }, volumeButton: { width: 33, height: 33, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#34363D' },
  volumeBar: { flex: 1, height: 5, overflow: 'hidden', borderRadius: 4, backgroundColor: '#41434A' }, volumeFill: { height: '100%', backgroundColor: theme.color.brand }, volumeText: { color: '#fff', fontSize: 11, fontWeight: '700', minWidth: 31, textAlign: 'right' },
  sheetFootnote: { color: '#82848C', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 11 },
  titleInput: { minHeight: 47, paddingHorizontal: 13, borderRadius: 10, color: '#fff', backgroundColor: '#24262D', borderWidth: 1, borderColor: '#383A43', fontSize: 14 }, characterCount: { alignSelf: 'flex-end', color: '#83858D', fontSize: 10, marginTop: 5 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { minHeight: 34, paddingHorizontal: 11, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#25272E', borderWidth: 1, borderColor: '#383A43' },
  choiceOn: { backgroundColor: '#4B1C34', borderColor: theme.color.brand }, choiceText: { color: '#D0D1D6', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' }, choiceTextOn: { color: '#FF6FA4', fontWeight: '800' },
  voiceCard: { minHeight: 145, borderRadius: 15, backgroundColor: '#22242B', alignItems: 'center', justifyContent: 'center', padding: 17 }, voicePulse: { width: 58, height: 58, borderRadius: 30, backgroundColor: '#3A2933', alignItems: 'center', justifyContent: 'center' }, voicePulseRecording: { backgroundColor: '#B5124E' }, voiceTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginTop: 11 }, voiceHint: { color: '#9A9CA4', fontSize: 11, textAlign: 'center', marginTop: 5 },
  recordButton: { minHeight: 48, borderRadius: 12, backgroundColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 13 }, stopRecordButton: { backgroundColor: '#C9354A' }, recordButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  toggleRow: { minHeight: 65, paddingHorizontal: 13, borderRadius: 12, backgroundColor: '#24262D', flexDirection: 'row', alignItems: 'center', gap: 13 }, toggleTitle: { color: '#fff', fontWeight: '800', fontSize: 13 }, toggleHint: { color: '#9698A0', fontSize: 10, marginTop: 3 }, toggle: { width: 45, height: 27, borderRadius: 14, padding: 3, backgroundColor: '#484A53', justifyContent: 'center' }, toggleOn: { backgroundColor: theme.color.brand }, toggleKnob: { width: 21, height: 21, borderRadius: 11, backgroundColor: '#fff' }, toggleKnobOn: { alignSelf: 'flex-end' },
  captionSample: { borderRadius: 11, backgroundColor: '#22242B', padding: 13, marginTop: 13 }, captionSampleLabel: { color: '#8E9098', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 7 }, captionSampleText: { color: '#fff', fontSize: 14, lineHeight: 19, fontWeight: '700' }, captionSampleTextMuted: { color: '#9A9CA3', fontSize: 11 },
  trimSection: { minHeight: 49, marginTop: 14, paddingTop: 11, borderTopWidth: 1, borderColor: '#2C2E35', flexDirection: 'row', alignItems: 'center', gap: 6 }, trimHeading: { color: '#E3E4E8', fontSize: 11, fontWeight: '700' }, trimValueText: { color: '#fff', fontSize: 11, fontWeight: '700', minWidth: 36, textAlign: 'center' },
  reorderRow: { minHeight: 42, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: '#2C2E35', flexDirection: 'row', alignItems: 'center', gap: 7 }, reorderButton: { minHeight: 31, borderRadius: 16, paddingHorizontal: 9, backgroundColor: '#30323A', flexDirection: 'row', alignItems: 'center', gap: 4 }, reorderText: { color: '#E4E5E9', fontSize: 10, fontWeight: '700' },
  trimControl: { minHeight: 35, flexDirection: 'row', alignItems: 'center', gap: 3 }, trimLabel: { color: '#93959D', fontSize: 9, fontWeight: '800' }, tinyButton: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#33353D', alignItems: 'center', justifyContent: 'center' },
  excludeRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderColor: '#2C2E35', marginTop: 9 }, excludeText: { color: '#E8E9EC', fontSize: 12, fontWeight: '600' },
  brollTimelineItem: { width: 94, height: 60, marginRight: 8, borderRadius: 8, overflow: 'hidden', backgroundColor: '#24262D', borderWidth: 1, borderColor: '#383A43' },
  brollTimelineImage: { width: '100%', height: 40 }, brollTimelineText: { color: '#D0D1D6', fontSize: 9, fontWeight: '700', paddingHorizontal: 5, paddingVertical: 3 },
  emptyBrollTrack: { height: 51, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1B1C21' },
  exportSummary: { minHeight: 37, justifyContent: 'center', alignItems: 'center', marginVertical: 13, borderRadius: 9, backgroundColor: '#24262D' }, exportSummaryText: { color: '#D5D6DB', fontSize: 11, fontWeight: '700' },
});
