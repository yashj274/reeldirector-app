import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { ClipVideoPreview } from '@/src/ClipVideoPreview';
import { useT } from '@/src/i18n';

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
};

const ASPECTS = [
  { id: '9:16', label: 'Reels / Shorts' },
  { id: '1:1', label: 'Square' },
  { id: '16:9', label: 'YouTube' },
];

const LOOKS = [
  { id: 'original', label: 'Original' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'mono', label: 'B&W' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'soft', label: 'Soft' },
  { id: 'luxury', label: 'Luxury' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'action', label: 'Action' },
  { id: 'fast_pace', label: 'Fast' },
  { id: 'minimal', label: 'Minimal' },
];

const CLIP_FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'mono', label: 'B&W' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'soft', label: 'Soft' },
];

const DEFAULT_SETTINGS: EditorSettings = {
  aspect_ratio: '9:16', fit_mode: 'fill', resolution: '1080p', fps: 30, editing_style: 'cinematic',
  clip_order: [], clip_edits: [], title_text: '', title_font: 'sans',
  title_position: 'bottom', title_color: 'white', title_size: 'medium',
  music_volume: 25, original_volume: 80,
};

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
      ? saved.clip_edits.find((edit: any) => edit.shot_index === id)
      : null;
    const end = Math.min(duration, Math.max(0.25, Number(old?.trim_end_seconds) || duration));
    return {
      shot_index: id,
      included: old?.included !== false,
      trim_start_seconds: Math.max(0, Math.min(end - 0.25, Number(old?.trim_start_seconds) || 0)),
      trim_end_seconds: end,
      filter_preset: CLIP_FILTERS.some((filter) => filter.id === old?.filter_preset)
        ? old.filter_preset : 'original',
      brightness: Math.max(-0.5, Math.min(0.5, Number(old?.brightness ?? clip?.brightness) || 0)),
    };
  });
  const savedMusicVolume = Number(saved.music_volume);
  const savedOriginalVolume = Number(saved.original_volume);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    music_volume: Number.isFinite(savedMusicVolume)
      ? (savedMusicVolume <= 1 ? savedMusicVolume * 100 : savedMusicVolume) : DEFAULT_SETTINGS.music_volume,
    original_volume: Number.isFinite(savedOriginalVolume)
      ? (savedOriginalVolume <= 1 ? savedOriginalVolume * 100 : savedOriginalVolume) : DEFAULT_SETTINGS.original_volume,
    clip_order: clipOrder,
    clip_edits: clipEdits,
  };
}

export default function Export() {
  const t = useT();
  const { id, clip: clipParam } = useLocalSearchParams<{ id: string; clip?: string }>();
  const router = useRouter();
  const editorScroll = useRef<any>(null);
  const focusedClip = useRef<number | null>(null);
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [notice, setNotice] = useState('');
  const [project, setProject] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [renderStage, setRenderStage] = useState('');
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!id) return;
    api.getProject(id).then((loaded) => {
      setProject(loaded);
      setSettings(makeSettings(loaded));
    }).catch((error: any) => setRenderError(error.message || 'Could not load this project.'));
  }, [id]);

  useEffect(() => {
    const shot = Number(clipParam);
    focusedClip.current = clipParam !== undefined && Number.isInteger(shot) ? shot : null;
  }, [clipParam]);

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

  const update = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setNotice('');
  };

  const updateClip = (shot: number, values: Partial<ClipEdit>) => {
    setSettings((current) => ({
      ...current,
      clip_edits: current.clip_edits.map((edit) => edit.shot_index === shot ? { ...edit, ...values } : edit),
    }));
    setDirty(true);
    setNotice('');
  };

  const editFor = (shot: number) => settings.clip_edits.find((edit) => edit.shot_index === shot)
    || { shot_index: shot, included: true, trim_start_seconds: 0, trim_end_seconds: 5, filter_preset: 'original', brightness: 0 };

  const moveClip = (shot: number, direction: -1 | 1) => {
    const currentOrder = [...settings.clip_order];
    const index = currentOrder.indexOf(shot);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= currentOrder.length) return;
    [currentOrder[index], currentOrder[target]] = [currentOrder[target], currentOrder[index]];
    update('clip_order', currentOrder);
  };

  const adjustTrim = (shot: number, edge: 'in' | 'out', amount: -0.5 | 0.5, duration: number) => {
    const edit = editFor(shot);
    if (edge === 'in') {
      const next = Math.max(0, Math.min(edit.trim_end_seconds - 0.25, edit.trim_start_seconds + amount));
      updateClip(shot, { trim_start_seconds: Math.round(next * 10) / 10 });
    } else {
      const next = Math.max(edit.trim_start_seconds + 0.25, Math.min(duration, edit.trim_end_seconds + amount));
      updateClip(shot, { trim_end_seconds: Math.round(next * 10) / 10 });
    }
  };

  const save = async () => {
    if (!id) return;
    setSaving(true);
    setRenderError('');
    try {
      await api.saveEditSettings(id, settings as any);
      setDirty(false);
      setNotice('Your edit settings are saved.');
    } catch (error: any) {
      setRenderError(error.message || 'Could not save your edit settings.');
    } finally {
      setSaving(false);
    }
  };

  const render = async () => {
    if (!id) return;
    setRendering(true);
    setRenderError('');
    setNotice('');
    setRenderStage('Applying your edits and preparing the video…');
    try {
      await api.saveEditSettings(id, settings as any);
      setDirty(false);
      await api.export(id, settings as any, () => setRenderStage('Saving your upload-ready video…'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace({ pathname: '/project/[id]/final', params: { id: id! } });
    } catch (error: any) {
      setRenderError(error.message || 'Could not render your video.');
    } finally {
      setRendering(false);
      setRenderStage('');
    }
  };

  const firstIncludedShot = orderedClips.find((clip: any, index: number) => editFor(shotIndex(clip, index)).included);
  const firstIncludedShotIndex = firstIncludedShot
    ? shotIndex(firstIncludedShot, orderedClips.indexOf(firstIncludedShot)) : -1;
  const estimatedDuration = orderedClips.reduce((total: number, clip: any, index: number) => {
    const edit = editFor(shotIndex(clip, index));
    if (!edit.included) return total;
    return total + Math.max(0, edit.trim_end_seconds - edit.trim_start_seconds);
  }, 0) * (settings.editing_style === 'fast_pace' ? 0.8 : 1);
  const selectedClipCount = orderedClips.filter((clip: any, index: number) => editFor(shotIndex(clip, index)).included).length;
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.root} testID="export-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="export-back">
            <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title}>{t('editor_title')}</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView ref={editorScroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.introCard}>
            <View style={styles.iconBadge}><Ionicons name="film-outline" size={22} color={theme.color.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heading}>{t('editor_heading')}</Text>
              <Text style={styles.subheading}>{t('editor_subheading')}</Text>
            </View>
          </View>

          <SectionTitle title={t('clip_order_trims')} subtitle={t('clip_order_help')} />
          {orderedClips.length ? orderedClips.map((clip: any, index: number) => {
            const shot = shotIndex(clip, index);
            const duration = Math.max(0.5, Number(clip.duration_seconds) || 5);
            const edit = editFor(shot);
            return (
              <View
                key={`${shot}-${clip.video_storage_path || index}`}
                style={[styles.clipCard, focusedClip.current === shot && styles.focusedClipCard]}
                onLayout={(event) => {
                  if (focusedClip.current !== shot) return;
                  focusedClip.current = null;
                  const y = Math.max(0, event.nativeEvent.layout.y - 12);
                  setTimeout(() => editorScroll.current?.scrollTo({ y, animated: true }), 80);
                }}
              >
                <View style={styles.clipHeader}>
                  <View style={styles.clipNumber}><Text style={styles.clipNumberText}>{index + 1}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clipTitle} numberOfLines={1}>{clip.title || `Shot ${shot + 1}`}</Text>
                    <Text style={styles.clipMeta}>{duration.toFixed(1)}s source · {clip.ai_generated ? t('ai_clip') : t('recorded_clip')}</Text>
                  </View>
                  <Pressable accessibilityLabel="Move clip up" style={styles.orderButton} onPress={() => moveClip(shot, -1)} disabled={index === 0}>
                    <Ionicons name="chevron-up" size={20} color={index === 0 ? theme.color.onSurface3 : theme.color.onSurface} />
                  </Pressable>
                  <Pressable accessibilityLabel="Move clip down" style={styles.orderButton} onPress={() => moveClip(shot, 1)} disabled={index === orderedClips.length - 1}>
                    <Ionicons name="chevron-down" size={20} color={index === orderedClips.length - 1 ? theme.color.onSurface3 : theme.color.onSurface} />
                  </Pressable>
                </View>

                <View style={styles.clipPreviewWrap}>
                  <Text style={styles.previewHint}>
                    {shot === firstIncludedShotIndex && settings.title_text
                      ? t('preview_opening_title')
                      : t('preview_selected_filter')}
                  </Text>
                  <ClipVideoPreview
                    uri={clip.video_url}
                    posterUri={clip.frame_url}
                    height={220}
                    filter={edit.filter_preset}
                    look={settings.editing_style}
                    brightness={edit.brightness}
                    title={shot === firstIncludedShotIndex ? settings.title_text : undefined}
                    titleFont={settings.title_font}
                    titlePosition={settings.title_position}
                    titleColor={settings.title_color}
                    titleSize={settings.title_size}
                  />
                </View>

                <Pressable style={[styles.includeToggle, !edit.included && styles.includeToggleOff]}
                  onPress={() => updateClip(shot, { included: !edit.included })}>
                  <Ionicons name={edit.included ? 'checkmark-circle' : 'remove-circle-outline'} size={17} color={edit.included ? theme.color.success : theme.color.onSurface3} />
                  <Text style={[styles.includeToggleText, !edit.included && styles.includeToggleTextOff]}>
                    {edit.included ? t('included_final') : t('skipped_final')}
                  </Text>
                </Pressable>

                <View style={styles.trimRow}>
                  <TrimControl label="IN" value={edit.trim_start_seconds} onMinus={() => adjustTrim(shot, 'in', -0.5, duration)} onPlus={() => adjustTrim(shot, 'in', 0.5, duration)} />
                  <View style={styles.trimDivider} />
                  <TrimControl label="OUT" value={edit.trim_end_seconds} onMinus={() => adjustTrim(shot, 'out', -0.5, duration)} onPlus={() => adjustTrim(shot, 'out', 0.5, duration)} />
                </View>

                <Text style={styles.rowLabel}>{t('clip_filter')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {CLIP_FILTERS.map((filter) => (
                    <Choice key={filter.id} label={filter.label} active={edit.filter_preset === filter.id}
                      onPress={() => updateClip(shot, { filter_preset: filter.id })} />
                  ))}
                </ScrollView>
                <View style={styles.brightnessRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{t('brightness')}</Text>
                    <Text style={styles.brightnessValue}>{Math.round(edit.brightness * 100)}%</Text>
                  </View>
                  <Pressable accessibilityLabel="Lower clip brightness" style={styles.tinyButton}
                    onPress={() => updateClip(shot, { brightness: Math.max(-0.5, Math.round((edit.brightness - 0.05) * 100) / 100) })}>
                    <Ionicons name="remove" size={16} color={theme.color.onSurface} />
                  </Pressable>
                  <Pressable accessibilityLabel="Raise clip brightness" style={styles.tinyButton}
                    onPress={() => updateClip(shot, { brightness: Math.min(0.5, Math.round((edit.brightness + 0.05) * 100) / 100) })}>
                    <Ionicons name="add" size={16} color={theme.color.onSurface} />
                  </Pressable>
                </View>
              </View>
            );
          }) : (
            <View style={styles.emptyCard}>
              <Ionicons name="videocam-outline" size={25} color={theme.color.onSurface3} />
              <Text style={styles.emptyText}>{t('record_clip_to_edit')}</Text>
            </View>
          )}

          <SectionTitle title={t('overall_look')} subtitle={t('overall_grade')} />
          <View style={styles.choiceGrid}>
            {LOOKS.map((look) => (
              <Choice key={look.id} label={look.label} active={settings.editing_style === look.id}
                onPress={() => update('editing_style', look.id)} />
            ))}
          </View>

          <SectionTitle title={t('title_text')} subtitle={t('title_overlay_help')} />
          <TextInput
            value={settings.title_text}
            onChangeText={(value) => update('title_text', value)}
            placeholder={t('type_title')}
            placeholderTextColor={theme.color.onSurface3}
            maxLength={80}
            style={styles.titleInput}
            accessibilityLabel="Video title text"
          />
          <Text style={styles.characterCount}>{settings.title_text.length}/80 characters</Text>
          <Text style={styles.rowLabel}>{t('font')}</Text>
          <View style={styles.choiceGrid}>
            <Choice label="Sans" active={settings.title_font === 'sans'} onPress={() => update('title_font', 'sans')} />
            <Choice label="Serif" active={settings.title_font === 'serif'} onPress={() => update('title_font', 'serif')} />
            <Choice label="Space Mono" active={settings.title_font === 'mono'} onPress={() => update('title_font', 'mono')} />
          </View>
          <Text style={styles.rowLabel}>{t('placement_size_color')}</Text>
          <View style={styles.choiceGrid}>
            {['top', 'center', 'bottom'].map((position) => <Choice key={position} label={position} active={settings.title_position === position} onPress={() => update('title_position', position)} />)}
          </View>
          <View style={styles.choiceGrid}>
            {['small', 'medium', 'large'].map((size) => <Choice key={size} label={size} active={settings.title_size === size} onPress={() => update('title_size', size)} />)}
          </View>
          <View style={styles.choiceGrid}>
            {[{ id: 'white', label: 'White' }, { id: 'gold', label: 'Gold' }, { id: 'pink', label: 'Pink' }, { id: 'black', label: 'Black' }].map((color) => <Choice key={color.id} label={color.label} active={settings.title_color === color.id} onPress={() => update('title_color', color.id)} />)}
          </View>

          <SectionTitle title={t('sound_mix')} subtitle={t('sound_mix_help')} />
          <VolumeControl label={t('original_clip_audio')} value={settings.original_volume} onChange={(value) => update('original_volume', value)} />
          <VolumeControl label={t('soundtrack')} value={settings.music_volume} onChange={(value) => update('music_volume', value)} />
          {!project?.soundtrack?.storage_path && (
            <Pressable style={styles.musicLink} onPress={() => router.push({ pathname: '/project/[id]/music', params: { id: id! } })}>
              <Ionicons name="musical-notes-outline" size={18} color={theme.color.brand} />
              <Text style={styles.musicLinkText}>{t('add_soundtrack')}</Text>
              <Ionicons name="chevron-forward" size={17} color={theme.color.brand} />
            </Pressable>
          )}

          <SectionTitle title={t('export_format')} subtitle={t('export_help')} />
          <View style={styles.choiceGrid}>
            {ASPECTS.map((item) => <Choice key={item.id} label={item.label} active={settings.aspect_ratio === item.id} onPress={() => update('aspect_ratio', item.id)} />)}
          </View>
          <Text style={styles.rowLabel}>{t('frame_clips')}</Text>
          <View style={styles.choiceGrid}>
            <Choice label={t('fill_frame')} active={settings.fit_mode === 'fill'} onPress={() => update('fit_mode', 'fill')} />
            <Choice label={t('fit_whole_clip')} active={settings.fit_mode === 'fit'} onPress={() => update('fit_mode', 'fit')} />
          </View>
          <Text style={styles.rowLabel}>{t('resolution')}</Text>
          <View style={styles.choiceGrid}>
            {['720p', '1080p'].map((resolution) => <Choice key={resolution} label={resolution} active={settings.resolution === resolution} onPress={() => update('resolution', resolution)} />)}
          </View>
          <Text style={styles.rowLabel}>{t('frame_rate')}</Text>
          <View style={styles.choiceGrid}>
            {[24, 30, 60].map((fps) => <Choice key={fps} label={`${fps} fps`} active={settings.fps === fps} onPress={() => update('fps', fps)} />)}
          </View>

          <View style={styles.metaBox}>
            <MetaRow label={t('clips_in_edit')} value={`${selectedClipCount} of ${orderedClips.length}`} />
            <MetaRow label={t('estimated_length')} value={`${estimatedDuration.toFixed(1)}s`} />
            <MetaRow label={t('export_size')} value={`${settings.resolution} · ${settings.fps} fps`} />
          </View>

          {!!notice && <Text style={styles.notice}>{notice}</Text>}
          {!!renderError && <Text style={styles.renderError} accessibilityRole="alert">{renderError}</Text>}
          {rendering && (
            <View style={styles.progressCard}>
              <Animated.View style={[styles.ring, { transform: [{ rotate: spin }] }]}>
                <LinearGradient colors={[theme.color.brand, 'rgba(224,17,95,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              </Animated.View>
              <View style={styles.ringInner}><ActivityIndicator color={theme.color.brand} /></View>
              <Text style={styles.progressText}>{renderStage || t('rendering_video')}</Text>
            </View>
          )}

          <Pressable style={[styles.saveButton, (saving || rendering || !dirty) && styles.disabledButton]} onPress={() => void save()} disabled={saving || rendering || !dirty}>
            {saving ? <ActivityIndicator color={theme.color.onSurface} /> : <Ionicons name="bookmark-outline" size={18} color={theme.color.onSurface} />}
            <Text style={styles.saveButtonText}>{saving ? t('saving') : dirty ? t('save_edit') : t('edits_saved')}</Text>
          </Pressable>
          <Pressable style={[styles.primary, (rendering || saving || !selectedClipCount) && styles.disabledPrimary]} onPress={() => void render()} disabled={rendering || saving || !selectedClipCount} testID="export-render-button">
            {rendering ? <ActivityIndicator color="#fff" /> : <Ionicons name="download-outline" size={19} color="#fff" />}
            <Text style={styles.primaryText}>{rendering ? t('rendering_video') : t('render_upload_ready')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View>;
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceOn]}><Text style={[styles.choiceText, active && styles.choiceTextOn]}>{label}</Text></Pressable>;
}

function TrimControl({ label, value, onMinus, onPlus }: { label: string; value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.trimControl}>
      <Text style={styles.trimLabel}>{label}</Text>
      <Pressable accessibilityLabel={`Move ${label.toLowerCase()} point earlier`} style={styles.tinyButton} onPress={onMinus}><Ionicons name="remove" size={16} color={theme.color.onSurface} /></Pressable>
      <Text style={styles.trimValue}>{value.toFixed(1)}s</Text>
      <Pressable accessibilityLabel={`Move ${label.toLowerCase()} point later`} style={styles.tinyButton} onPress={onPlus}><Ionicons name="add" size={16} color={theme.color.onSurface} /></Pressable>
    </View>
  );
}

function VolumeControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.volumeRow}>
      <View style={{ flex: 1 }}><Text style={styles.volumeLabel}>{label}</Text><Text style={styles.volumeValue}>{value}%</Text></View>
      <Pressable accessibilityLabel={`Lower ${label}`} style={styles.volumeButton} onPress={() => onChange(Math.max(0, value - 10))}><Ionicons name="remove" size={18} color={theme.color.onSurface} /></Pressable>
      <Pressable accessibilityLabel={`Raise ${label}`} style={styles.volumeButton} onPress={() => onChange(Math.min(100, value + 10))}><Ionicons name="add" size={18} color={theme.color.onSurface} /></Pressable>
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.metaRow}><Text style={styles.metaLabel}>{label}</Text><Text style={styles.metaValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { flex: 1, textAlign: 'center', color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  content: { paddingHorizontal: 18, paddingBottom: 42 },
  introCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderRadius: theme.radius.lg, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  iconBadge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.brandTint },
  heading: { color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  subheading: { color: theme.color.onSurface2, fontSize: 12, lineHeight: 18, marginTop: 4 },
  sectionTitle: { marginTop: 25, marginBottom: 11 },
  sectionHeading: { color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  sectionSubtitle: { color: theme.color.onSurface3, fontSize: 12, lineHeight: 17, marginTop: 4 },
  clipCard: { marginTop: 9, padding: 13, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  focusedClipCard: { borderColor: theme.color.brand, borderWidth: 2 },
  clipPreviewWrap: { marginTop: 11, gap: 7 },
  previewHint: { color: theme.color.onSurface3, fontSize: 11, fontWeight: '600' },
  clipHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  includeToggle: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', minHeight: 31, paddingHorizontal: 9, marginTop: 7, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandTint },
  includeToggleOff: { backgroundColor: theme.color.surface3 },
  includeToggleText: { color: theme.color.success, fontSize: 11, fontWeight: '700' },
  includeToggleTextOff: { color: theme.color.onSurface3 },
  clipNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.color.brandTint, alignItems: 'center', justifyContent: 'center' },
  clipNumberText: { color: theme.color.brand, fontWeight: '800' },
  clipTitle: { color: theme.color.onSurface, fontWeight: '700', fontSize: 14 },
  clipMeta: { color: theme.color.onSurface3, fontSize: 11, marginTop: 2 },
  orderButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface3 },
  trimRow: { flexDirection: 'row', alignItems: 'center', marginTop: 13, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.divider },
  trimControl: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
  trimLabel: { color: theme.color.onSurface3, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  trimValue: { minWidth: 40, color: theme.color.onSurface, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  trimDivider: { width: 1, height: 26, backgroundColor: theme.color.divider, marginHorizontal: 10 },
  tinyButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface3 },
  rowLabel: { color: theme.color.onSurface3, fontSize: 11, fontWeight: '700', marginTop: 14, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0.6 },
  filterRow: { gap: 7, paddingRight: 8 },
  brightnessRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 },
  brightnessValue: { color: theme.color.onSurface3, fontSize: 11, marginTop: 2 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  choice: { minHeight: 37, paddingHorizontal: 13, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  choiceOn: { backgroundColor: theme.color.brandTint, borderColor: theme.color.brand },
  choiceText: { color: theme.color.onSurface2, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  choiceTextOn: { color: theme.color.brand, fontWeight: '700' },
  emptyCard: { minHeight: 90, padding: 18, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { color: theme.color.onSurface3, textAlign: 'center', fontSize: 13 },
  titleInput: { minHeight: 49, paddingHorizontal: 14, borderRadius: theme.radius.md, color: theme.color.onSurface, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, fontSize: 15 },
  characterCount: { alignSelf: 'flex-end', color: theme.color.onSurface3, fontSize: 10, marginTop: 5 },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  volumeLabel: { color: theme.color.onSurface, fontSize: 13, fontWeight: '600' },
  volumeValue: { color: theme.color.brand, fontSize: 11, fontWeight: '700', marginTop: 3 },
  volumeButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  musicLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9, minHeight: 47, marginTop: 10, paddingHorizontal: 13, borderRadius: theme.radius.md, backgroundColor: theme.color.brandTint },
  musicLinkText: { flex: 1, color: theme.color.brand, fontWeight: '700', fontSize: 13 },
  metaBox: { marginTop: 21, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: theme.color.divider },
  metaLabel: { color: theme.color.onSurface2, fontSize: 12 },
  metaValue: { color: theme.color.onSurface, fontSize: 12, fontWeight: '700' },
  notice: { color: theme.color.success, textAlign: 'center', marginTop: 12, fontSize: 12 },
  renderError: { color: theme.color.error, textAlign: 'center', marginTop: 12, lineHeight: 19 },
  progressCard: { minHeight: 100, marginTop: 15, borderRadius: theme.radius.lg, backgroundColor: theme.color.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ring: { position: 'absolute', width: 68, height: 68, borderRadius: 34, overflow: 'hidden' },
  ringInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: theme.color.surface, alignItems: 'center', justifyContent: 'center' },
  progressText: { color: theme.color.onSurface2, fontSize: 11, marginTop: 6 },
  saveButton: { marginTop: 20, height: 49, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  saveButtonText: { color: theme.color.onSurface, fontWeight: '700' },
  disabledButton: { opacity: 0.55 },
  primary: { marginTop: 9, height: 56, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  disabledPrimary: { opacity: 0.55 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
