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

import { api } from '@/src/api';
import { theme } from '@/src/theme';

type ClipEdit = {
  shot_index: number;
  included: boolean;
  trim_start_seconds: number;
  trim_end_seconds: number;
  filter_preset: string;
  brightness: number;
};

type EditorSettings = {
  aspect_ratio: string;
  fit_mode: string;
  resolution: string;
  fps: number;
  editing_style: string;
  clip_order: number[];
  clip_edits: ClipEdit[];
  title_text: string;
  title_font: string;
  title_position: string;
  title_color: string;
  title_size: string;
  music_volume: number;
  original_volume: number;
  captions_enabled: boolean;
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
  { id: 'soft', label: 'Soft' },
];

const DEFAULT_SETTINGS: EditorSettings = {
  aspect_ratio: '9:16', fit_mode: 'fill', resolution: '1080p', fps: 30, editing_style: 'cinematic',
  clip_order: [], clip_edits: [], title_text: '', title_font: 'sans',
  title_position: 'bottom', title_color: 'white', title_size: 'medium',
  music_volume: 25, original_volume: 80, captions_enabled: false,
};

const FILTERS: Record<string, string> = {
  warm: 'sepia(0.16) saturate(1.12)', cool: 'hue-rotate(9deg) saturate(1.06)',
  mono: 'grayscale(1) contrast(1.04)', vivid: 'saturate(1.22) contrast(1.08)',
  vintage: 'sepia(0.24) saturate(0.8) contrast(0.92)', soft: 'saturate(0.92) contrast(0.92)',
  cinematic: 'contrast(1.08) saturate(0.9)', luxury: 'contrast(1.08) saturate(0.94)',
  editorial: 'contrast(1.06) saturate(0.86)', action: 'contrast(1.12) saturate(1.12)',
  fast_pace: 'contrast(1.08) saturate(1.12)', minimal: 'saturate(0.85)',
};

const TITLE_COLORS: Record<string, string> = { white: '#fff', gold: '#F5C869', pink: '#E0115F', black: '#101114' };

function shotIndex(clip: any, fallback: number) {
  const value = Number(clip?.shot_index);
  return Number.isInteger(value) ? value : fallback;
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
    };
  });
  const musicVolume = Number(saved.music_volume);
  const originalVolume = Number(saved.original_volume);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    music_volume: Number.isFinite(musicVolume) ? (musicVolume <= 1 ? musicVolume * 100 : musicVolume) : DEFAULT_SETTINGS.music_volume,
    original_volume: Number.isFinite(originalVolume) ? (originalVolume <= 1 ? originalVolume * 100 : originalVolume) : DEFAULT_SETTINGS.original_volume,
    captions_enabled: saved.captions_enabled === true,
    clip_order: clipOrder,
    clip_edits: clipEdits,
  };
}

function clock(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function Export() {
  const { id, clip: clipParam } = useLocalSearchParams<{ id: string; clip?: string }>();
  const router = useRouter();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [project, setProject] = useState<any>(null);
  const [selectedShot, setSelectedShot] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderStage, setRenderStage] = useState('');
  const [renderError, setRenderError] = useState('');
  const [notice, setNotice] = useState('');
  const [tool, setTool] = useState<ToolName | null>(null);
  const [toolError, setToolError] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [addingClip, setAddingClip] = useState(false);
  const [addClipError, setAddClipError] = useState('');
  const historyBack = useRef<EditorSettings[]>([]);
  const historyForward = useRef<EditorSettings[]>([]);
  const desiredTime = useRef(0);
  const initialLoadComplete = useRef(false);
  const dirtyRef = useRef(dirty);
  const selectedShotRef = useRef(selectedShot);
  dirtyRef.current = dirty;
  selectedShotRef.current = selectedShot;
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
      setProject(loaded);
      const next = makeSettings(loaded);
      if (selectedShotRef.current === null) {
        const first = (loaded.clips || []).find((clip: any, index: number) => next.clip_edits.find((edit) => edit.shot_index === shotIndex(clip, index))?.included);
        if (first) {
          const firstShot = shotIndex(first, 0);
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
        };
      });
      setRenderError('');
    }).catch((error: any) => { if (alive) setRenderError(error.message || 'Could not load this project.'); });
    return () => { alive = false; };
  }, [id]));

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
  const activeClip = orderedClips.find((clip: any, index: number) => shotIndex(clip, index) === selectedShot)
    || orderedClips.find((clip: any, index: number) => editForShot(settings, shotIndex(clip, index)).included)
    || orderedClips[0];
  const activeShot = activeClip ? shotIndex(activeClip, orderedClips.indexOf(activeClip)) : -1;
  const activeEdit = activeShot >= 0 ? editForShot(settings, activeShot) : null;
  const activeStoryboard = activeShot >= 0 ? project?.storyboard?.[activeShot] : null;
  const openingClip = orderedClips.find((clip: any, index: number) => editForShot(settings, shotIndex(clip, index)).included);
  const openingShot = openingClip ? shotIndex(openingClip, orderedClips.indexOf(openingClip)) : -1;
  const showTitleOverlay = !!settings.title_text && activeShot === openingShot
    && currentTime - (activeEdit?.trim_start_seconds || 0) < 3.5;
  const activeClipEnd = activeEdit?.trim_end_seconds ?? Number(activeClip?.duration_seconds ?? playerDuration);
  const activeVideoUri = activeClip?.video_url || null;
  const activeTrimStart = activeEdit?.trim_start_seconds || 0;
  const activeSourceDuration = Number(activeClip?.duration_seconds) || 0;
  const selectedDuration = activeEdit ? Math.max(0.1, activeEdit.trim_end_seconds - activeEdit.trim_start_seconds) : playerDuration;
  const captionText = activeStoryboard?.on_screen_text || '';
  const activeFilter = activeEdit?.filter_preset || 'original';
  const webPreviewFilter = [FILTERS[activeFilter], FILTERS[settings.editing_style], activeEdit ? `brightness(${1 + activeEdit.brightness})` : null].filter(Boolean).join(' ');
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const player = useVideoPlayer(activeClip?.video_url || null, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = true;
    videoPlayer.timeUpdateEventInterval = 0.12;
  });

  useEffect(() => {
    if (!activeVideoUri) {
      setCurrentTime(0);
      setPlayerDuration(0);
      setPlaying(false);
      return;
    }
    const start = activeTrimStart;
    desiredTime.current = start;
    setCurrentTime(start);
    setPlayerDuration(Math.max(0, activeSourceDuration));
    player.pause();
    setPlaying(false);
  }, [activeVideoUri, activeTrimStart, activeSourceDuration, activeShot, player]);

  useEffect(() => {
    const timeSub = player.addListener('timeUpdate', ({ currentTime: time }) => {
      if (time >= activeClipEnd - 0.04) {
        player.pause();
        player.currentTime = activeClipEnd;
        setCurrentTime(activeClipEnd);
        setPlaying(false);
      } else {
        setCurrentTime(time);
      }
    });
    const sourceSub = player.addListener('sourceLoad', ({ duration }) => {
      setPlayerDuration(duration || 0);
      const start = Math.min(desiredTime.current, Math.max(0, duration - 0.05));
      if (Number.isFinite(start)) player.currentTime = start;
    });
    const playingSub = player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying));
    const endSub = player.addListener('playToEnd', () => setPlaying(false));
    return () => { timeSub.remove(); sourceSub.remove(); playingSub.remove(); endSub.remove(); };
  }, [player, activeClipEnd]);

  const pushHistory = (current: EditorSettings) => {
    historyBack.current = [...historyBack.current.slice(-39), current];
    historyForward.current = [];
  };

  const update = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
    setSettings((current) => {
      pushHistory(current);
      return { ...current, [key]: value };
    });
    setDirty(true);
    setNotice('');
  };

  const updateClip = (shot: number, values: Partial<ClipEdit>) => {
    setSettings((current) => {
      pushHistory(current);
      return {
        ...current,
        clip_edits: current.clip_edits.map((edit) => edit.shot_index === shot ? { ...edit, ...values } : edit),
      };
    });
    setDirty(true);
    setNotice('');
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

  const selectClip = (shot: number) => {
    setSelectedShot(shot);
    const edit = editForShot(settings, shot);
    desiredTime.current = edit.trim_start_seconds;
    setCurrentTime(edit.trim_start_seconds);
    player.pause();
    player.currentTime = edit.trim_start_seconds;
    setPlaying(false);
  };

  const togglePlayback = () => {
    if (!activeClip?.video_url) return;
    if (player.playing) {
      player.pause();
      setPlaying(false);
    } else {
      if (currentTime >= activeClipEnd - 0.05) {
        player.currentTime = activeEdit?.trim_start_seconds || 0;
        setCurrentTime(activeEdit?.trim_start_seconds || 0);
      }
      player.play();
      setPlaying(true);
    }
  };

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
      await api.saveEditSettings(id, settings as any);
      setDirty(false);
      await api.export(id, settings as any, () => setRenderStage('Preparing your upload-ready video…'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace({ pathname: '/project/[id]/final', params: { id } });
    } catch (error: any) {
      setRenderError(error.message || 'Could not render your video.');
    } finally {
      setRendering(false);
      setRenderStage('');
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

  const openTool = (name: ToolName) => {
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

  const removeAudio = () => {
    if (!id) return;
    Alert.alert('Remove audio track?', 'This will remove the music or voice recording from this reel.', [
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
    if (project?.soundtrack?.storage_path) {
      Alert.alert('Replace the current audio?', 'This editor currently exports one audio track. Saving a voice recording will replace the music track.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => { void beginRecording(); } },
      ]);
    } else {
      await beginRecording();
    }
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
      const saved = await api.saveSoundtrack(id, {
        uri, name: `voiceover-${Date.now()}.${extension}`, mimeType, file: audioBlob,
      });
      setProject((current: any) => ({ ...current, soundtrack: saved }));
      setNotice('Voice recording added as the reel audio track');
    } catch (error: any) {
      setToolError(error.message || 'Could not save your voice recording.');
    } finally { setAudioBusy(false); }
  };

  const estimatedDuration = orderedClips.reduce((total: number, clip: any, index: number) => {
    const edit = editForShot(settings, shotIndex(clip, index));
    return edit.included ? total + Math.max(0, edit.trim_end_seconds - edit.trim_start_seconds) : total;
  }, 0) * (settings.editing_style === 'fast_pace' ? 0.8 : 1);
  const includedCount = orderedClips.filter((clip: any, index: number) => editForShot(settings, shotIndex(clip, index)).included).length;
  const previewHeight = Math.max(235, Math.min(windowHeight * 0.47, 490));
  const [ratioWidth, ratioHeight] = settings.aspect_ratio.split(':').map(Number);
  const outputRatio = ratioWidth > 0 && ratioHeight > 0 ? ratioWidth / ratioHeight : 9 / 16;
  const previewMediaWidth = Math.min(windowWidth, previewHeight * outputRatio);
  const previewMediaHeight = Math.min(previewHeight, windowWidth / outputRatio);

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

      <ScrollView style={styles.editorScroll} contentContainerStyle={styles.editorBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.preview, { height: previewHeight }]}>
          <View style={[styles.previewMedia, { width: previewMediaWidth, height: previewMediaHeight }]}>
            {activeClip?.frame_url ? <Image source={{ uri: activeClip.frame_url }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
            {activeClip?.video_url ? (
              <VideoView
                player={player}
                style={[StyleSheet.absoluteFill, Platform.OS === 'web' && webPreviewFilter ? ({ filter: webPreviewFilter } as any) : null]}
                contentFit={settings.fit_mode === 'fit' ? 'contain' : 'cover'}
                nativeControls={false}
                allowsFullscreen={false}
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
            {showTitleOverlay && (
              <View pointerEvents="none" style={[styles.titleOverlay, settings.title_position === 'top' ? styles.titleTop : settings.title_position === 'center' ? styles.titleCenter : styles.titleBottom]}>
                <Text numberOfLines={2} style={[
                  styles.previewTitle,
                  { color: TITLE_COLORS[settings.title_color] || '#fff', fontFamily: settings.title_font === 'serif' ? 'Georgia' : settings.title_font === 'mono' ? 'Courier New' : undefined,
                    fontSize: settings.title_size === 'large' ? 23 : settings.title_size === 'small' ? 14 : 18 },
                  settings.title_color === 'black' && styles.previewTitleDark,
                ]}>{settings.title_text}</Text>
              </View>
            )}
            {settings.captions_enabled && !!captionText && (
              <View pointerEvents="none" style={styles.captionOverlay}><Text numberOfLines={2} style={styles.captionText}>{captionText}</Text></View>
            )}
          </View>
          <View style={styles.previewTopRow}>
            {!!activeFilter && activeFilter !== 'original' ? <Text style={styles.previewBadge}>{activeFilter.replace('_', ' ')}</Text> : <View />}
            <Text style={styles.previewCounter}>{activeClip ? `CLIP ${Math.max(0, orderedClips.indexOf(activeClip)) + 1} / ${orderedClips.length}` : 'PREVIEW'}</Text>
          </View>
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
          <Text style={styles.timecode}>{clock(currentTime - (activeEdit?.trim_start_seconds || 0))}<Text style={styles.timeDivider}> / </Text>{clock(selectedDuration)}</Text>
          <View style={styles.transportSpacer} />
          <Pressable style={styles.roundControl} onPress={undo} disabled={!historyBack.current.length} accessibilityLabel="Undo edit">
            <Ionicons name="arrow-undo" size={19} color={historyBack.current.length ? '#fff' : '#686A72'} />
          </Pressable>
          <Pressable style={styles.roundControl} onPress={redo} disabled={!historyForward.current.length} accessibilityLabel="Redo edit">
            <Ionicons name="arrow-redo" size={19} color={historyForward.current.length ? '#fff' : '#686A72'} />
          </Pressable>
        </View>

        <View style={styles.timeline}>
          <View style={styles.ruler}>
            <Text style={styles.rulerDot}>•</Text><Text style={styles.rulerTime}>0s</Text>
            <Text style={styles.rulerDot}>•</Text><Text style={styles.rulerTime}>{Math.max(1, Math.round(estimatedDuration / 2))}s</Text>
            <Text style={styles.rulerDot}>•</Text><Text style={styles.rulerTime}>{Math.ceil(estimatedDuration)}s</Text>
          </View>
          <View style={styles.clipTrack}>
            {orderedClips.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clipStrip}>
                {orderedClips.map((clip: any, index: number) => {
                  const shot = shotIndex(clip, index);
                  const duration = Math.max(0.5, Number(clip.duration_seconds) || 5);
                  const edit = editForShot(settings, shot);
                  const selected = shot === activeShot;
                  return (
                    <TimelineClip
                      key={`${shot}-${clip.video_storage_path || index}`}
                      clip={clip}
                      shot={shot}
                      duration={duration}
                      edit={edit}
                      selected={selected}
                      onSelect={() => selectClip(shot)}
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
          <View style={styles.trackRow}>
            <Ionicons name="musical-notes" size={17} color="#B9BBC3" />
            <Text style={styles.trackPlaceholder} numberOfLines={1}>{project?.soundtrack?.title || 'Tap to add audio'}</Text>
            {!!project?.soundtrack?.title && <Text style={styles.trackTag}>AUDIO</Text>}
          </View>
          <View style={styles.trackRow}>
            <Text style={styles.trackAa}>Aa</Text>
            <Text style={styles.trackPlaceholder} numberOfLines={1}>{settings.title_text || 'Tap to add text'}</Text>
            {!!settings.captions_enabled && <Text style={styles.trackTag}>CAPTIONS</Text>}
          </View>
          {orderedClips.length ? <View pointerEvents="none" style={styles.playhead} /> : null}
          <Text style={styles.timelineHint}>Drag a clip edge to trim · Tap a clip to preview</Text>
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
            <Text style={styles.sheetDescription}>{project?.soundtrack?.title ? 'Audio is on the timeline. Adjust its level or replace it.' : 'Add a song or ambient track to your reel.'}</Text>
            <View style={styles.audioTrackCard}>
              <View style={styles.audioIcon}><Ionicons name="musical-notes" size={21} color="#fff" /></View>
              <View style={{ flex: 1 }}><Text style={styles.audioTitle} numberOfLines={1}>{project?.soundtrack?.title || 'No audio added yet'}</Text><Text style={styles.audioMeta}>{project?.soundtrack?.title ? 'Audio track · starts at the beginning' : 'Choose an audio file from your device'}</Text></View>
              {project?.soundtrack?.storage_path ? <Pressable onPress={removeAudio} style={styles.smallIconButton} accessibilityLabel="Remove audio"><Ionicons name="trash-outline" size={18} color="#F87171" /></Pressable> : null}
            </View>
            <ActionButton icon="folder-open-outline" label={project?.soundtrack?.title ? 'Replace audio' : 'Choose audio'} onPress={() => void chooseAudio()} loading={audioBusy} />
            <Text style={styles.rowLabel}>AUDIO VOLUME · {settings.music_volume}%</Text>
            <VolumeControl value={settings.music_volume} onChange={(value) => update('music_volume', value)} />
            <Text style={styles.rowLabel}>CLIP SOUND · {settings.original_volume}%</Text>
            <VolumeControl value={settings.original_volume} onChange={(value) => update('original_volume', value)} />
            <Text style={styles.sheetFootnote}>Adding a new track replaces the current audio file.</Text>
          </>
        ) : null}

        {tool === 'Text' ? (
          <>
            <Text style={styles.sheetDescription}>Add a title that appears in the preview and finished video.</Text>
            <TextInput value={settings.title_text} onChangeText={(value) => update('title_text', value)} placeholder="Write your title" placeholderTextColor="#747780" maxLength={80} style={styles.titleInput} accessibilityLabel="Video title text" />
            <Text style={styles.characterCount}>{settings.title_text.length}/80</Text>
            <Text style={styles.rowLabel}>FONT</Text>
            <ChoiceRow options={[['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']]} selected={settings.title_font} onSelect={(value) => update('title_font', value)} />
            <Text style={styles.rowLabel}>POSITION</Text>
            <ChoiceRow options={['top', 'center', 'bottom'].map((value) => [value, value])} selected={settings.title_position} onSelect={(value) => update('title_position', value)} />
            <Text style={styles.rowLabel}>SIZE</Text>
            <ChoiceRow options={['small', 'medium', 'large'].map((value) => [value, value])} selected={settings.title_size} onSelect={(value) => update('title_size', value)} />
            <Text style={styles.rowLabel}>COLOR</Text>
            <ChoiceRow options={['white', 'gold', 'pink', 'black'].map((value) => [value, value])} selected={settings.title_color} onSelect={(value) => update('title_color', value)} />
          </>
        ) : null}

        {tool === 'Voice' ? (
          <>
            <Text style={styles.sheetDescription}>Record narration with your phone microphone. It will become the reel’s audio track.</Text>
            <View style={styles.voiceCard}>
              <View style={[styles.voicePulse, recordingVoice && styles.voicePulseRecording]}><Ionicons name={recordingVoice ? 'mic' : 'mic-outline'} size={28} color="#fff" /></View>
              <Text style={styles.voiceTitle}>{recordingVoice ? 'Recording your voice…' : 'Record a voiceover'}</Text>
              <Text style={styles.voiceHint}>{recordingVoice ? 'Tap stop when you are done.' : 'Find a quiet place, then tap below to start.'}</Text>
            </View>
            <Pressable style={[styles.recordButton, recordingVoice && styles.stopRecordButton]} onPress={() => void (recordingVoice ? stopVoiceRecording() : startVoiceRecording())} disabled={audioBusy}>
              {audioBusy ? <ActivityIndicator color="#fff" /> : <Ionicons name={recordingVoice ? 'stop' : 'mic'} size={19} color="#fff" />}
              <Text style={styles.recordButtonText}>{audioBusy ? 'Saving recording…' : recordingVoice ? 'Stop and add voiceover' : 'Start recording'}</Text>
            </Pressable>
            <Text style={styles.sheetFootnote}>The current renderer uses one audio track, so a voiceover replaces any music already added.</Text>
          </>
        ) : null}

        {tool === 'Captions' ? (
          <>
            <Text style={styles.sheetDescription}>Show the short on-screen text from your custom shot plan. Captions are burned into the exported video.</Text>
            <Pressable style={styles.toggleRow} onPress={() => update('captions_enabled', !settings.captions_enabled)}>
              <View style={{ flex: 1 }}><Text style={styles.toggleTitle}>Captions</Text><Text style={styles.toggleHint}>{settings.captions_enabled ? 'Included in the preview and export' : 'Off for this reel'}</Text></View>
              <View style={[styles.toggle, settings.captions_enabled && styles.toggleOn]}><View style={[styles.toggleKnob, settings.captions_enabled && styles.toggleKnobOn]} /></View>
            </Pressable>
            {captionText ? <View style={styles.captionSample}><Text style={styles.captionSampleLabel}>CURRENT CLIP</Text><Text style={styles.captionSampleText}>{captionText}</Text></View> : <View style={styles.captionSample}><Text style={styles.captionSampleLabel}>CURRENT CLIP</Text><Text style={styles.captionSampleTextMuted}>No caption text was added to this shot plan.</Text></View>}
          </>
        ) : null}

        {tool === 'Overlay' ? (
          <>
            <Text style={styles.sheetDescription}>Set the title overlay placement and the frame shape for your finished reel.</Text>
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
            <Text style={styles.sheetDescription}>Apply a look to the whole reel or a filter to just the selected clip.</Text>
            <Text style={styles.rowLabel}>WHOLE REEL LOOK</Text>
            <View style={styles.choiceGrid}>{LOOKS.map((look) => <Choice key={look.id} label={look.label} active={settings.editing_style === look.id} onPress={() => update('editing_style', look.id)} />)}</View>
            {!!activeEdit && (
              <>
                <Text style={styles.rowLabel}>SELECTED CLIP · {Math.max(0, orderedClips.findIndex((clip: any) => shotIndex(clip, -1) === activeShot)) + 1}</Text>
                <View style={styles.choiceGrid}>{CLIP_FILTERS.map((filter) => <Choice key={filter.id} label={filter.label} active={activeEdit.filter_preset === filter.id} onPress={() => updateClip(activeShot, { filter_preset: filter.id })} />)}</View>
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
                <Pressable style={styles.excludeRow} onPress={() => updateClip(activeShot, { included: !activeEdit.included })}>
                  <Ionicons name={activeEdit.included ? 'checkmark-circle-outline' : 'add-circle-outline'} size={20} color={activeEdit.included ? '#fff' : theme.color.brand} />
                  <Text style={styles.excludeText}>{activeEdit.included ? 'Include this clip in export' : 'Add this clip to export'}</Text>
                </Pressable>
              </>
            )}
          </>
        ) : null}

        {tool === 'Export settings' ? (
          <>
            <Text style={styles.sheetDescription}>Choose a format before exporting your reel.</Text>
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
    || { shot_index: shot, included: true, trim_start_seconds: 0, trim_end_seconds: 5, filter_preset: 'original', brightness: 0 };
}

function nativeTint(clipFilter: string, look: string) {
  const selected = clipFilter !== 'original' ? clipFilter : look;
  const tints: Record<string, string> = {
    warm: 'rgba(233,139,65,0.15)', cool: 'rgba(62,129,220,0.15)', vintage: 'rgba(185,139,78,0.17)',
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

function TimelineClip({ clip, shot, duration, edit, selected, onSelect, onTrim }: {
  clip: any; shot: number; duration: number; edit: ClipEdit; selected: boolean;
  onSelect: () => void; onTrim: (values: Partial<ClipEdit>) => void;
}) {
  const width = Math.min(220, Math.max(96, duration * 26));
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
      <View style={styles.clipCellBadge}><Text style={styles.clipCellBadgeText}>{shot + 1}</Text></View>
      {selected ? (
        <>
          <View {...leftPan.panHandlers} style={[styles.trimHandle, styles.trimHandleLeft, { left: `${leftPercent * 100}%` }]} accessibilityLabel="Drag to trim the start of this clip"><View style={styles.trimGrip} /></View>
          <View {...rightPan.panHandlers} style={[styles.trimHandle, styles.trimHandleRight, { right: `${rightPercent * 100}%` }]} accessibilityLabel="Drag to trim the end of this clip"><View style={styles.trimGrip} /></View>
        </>
      ) : null}
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
  captionOverlay: { position: 'absolute', bottom: '7%', left: 18, right: 18, alignItems: 'center' },
  captionText: { maxWidth: '96%', color: '#fff', backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, textAlign: 'center', fontSize: 15, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 2 },
  renderingPill: { position: 'absolute', bottom: 14, alignSelf: 'center', minHeight: 36, maxWidth: '88%', borderRadius: 18, paddingHorizontal: 12, backgroundColor: 'rgba(16,16,18,0.86)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  renderingText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  transport: { minHeight: 58, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: '#202126' },
  roundControl: { width: 39, height: 39, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1B1C21' },
  timecode: { color: '#F1F1F4', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginLeft: 7 },
  timeDivider: { color: '#777982' },
  transportSpacer: { flex: 1 },
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
  addClip: { width: 47, height: 47, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginHorizontal: 6 },
  playhead: { position: 'absolute', left: '50%', top: 33, height: 180, width: 2, marginLeft: -1, backgroundColor: '#fff', zIndex: 5 },
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
  exportSummary: { minHeight: 37, justifyContent: 'center', alignItems: 'center', marginVertical: 13, borderRadius: 9, backgroundColor: '#24262D' }, exportSummaryText: { color: '#D5D6DB', fontSize: 11, fontWeight: '700' },
});
