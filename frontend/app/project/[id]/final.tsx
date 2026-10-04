import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';

import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { useT } from '@/src/i18n';

const STYLES = ['cinematic', 'luxury', 'minimal', 'action', 'editorial', 'warm', 'fast_pace'];
const RATIOS = [
  { id: '9:16', label: 'Instagram / TikTok · 9:16', icon: 'logo-instagram' as const },
  { id: '9:16-yt', label: 'YouTube Shorts · 9:16', icon: 'logo-youtube' as const },
  { id: '1:1', label: 'Square · 1:1', icon: 'square-outline' as const },
  { id: '16:9', label: 'Landscape · 16:9', icon: 'tv-outline' as const },
];

export default function FinalPlayer() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [fs, setFs] = useState(false);
  const [showFormats, setShowFormats] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getProject(id).then((p) => {
      // If no export yet, render one automatically
      if (!p.export) {
        api.export(id).then((exp) => {
          setProject({ ...p, export: exp });
          setLoading(false);
        }).catch((e) => { setLoadError(e.message || 'Could not render your video.'); setLoading(false); });
      } else {
        setProject(p); setLoading(false);
      }
    }).catch((e) => { setLoadError(e.message || 'Could not load this project.'); setLoading(false); });
  }, [id]);

  const url = project?.export?.url;
  const player = useVideoPlayer(url || null, (p) => {
    p.loop = true;
    p.muted = false;
  });

  useEffect(() => {
    if (url) player.play();
  }, [url, player]);

  const rebuild = async (opts: { editing_style?: string; aspect_ratio?: string } = {}) => {
    if (!id) return;
    setRebuilding(true);
    setActionError('');
    try {
      const exp = await api.export(id, opts);
      setProject((p: any) => ({ ...p, export: exp }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) { setActionError(e.message || 'Could not render your video.'); }
    finally { setRebuilding(false); }
  };

  const shareIt = async () => {
    if (!url) return;
    try { await Share.share({ message: `Check out my reel: ${url}` }); } catch {}
  };

  const downloadIt = async () => {
    if (!url || downloading) return;
    setDownloading(true);
    try {
      if (Platform.OS === 'web') {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${(project?.title || 'reel').replace(/[^a-z0-9_-]/gi, '-')}.mp4`;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return;
      }
      const local = await File.downloadFileAsync(
        url,
        new File(Paths.cache, 'reeldirector-reel.mp4'),
        { idempotent: true },
      );
      const permission = await MediaLibrary.requestPermissionsAsync(true, ['video']);
      if (!permission.granted) throw new Error('Allow photo-library access to save the video.');
      await MediaLibrary.saveToLibraryAsync(local.uri);
      Alert.alert(t('video_saved'), t('reel_saved_library'));
    } catch (e: any) {
      Alert.alert(t('save_video_failed'), e.message || t('try_again'));
    } finally {
      setDownloading(false);
    }
  };

  const styleName = useMemo(() =>
    (project?.export?.editing_style || project?.style || 'cinematic').replace('_', ' '),
    [project],
  );

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.color.brand} />
        <Text style={{ color: theme.color.onSurface2, marginTop: 12 }}>{t('loading_reel')}</Text>
      </View>
    );
  }

  if (!project) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', padding: 28 }]}>
        <Ionicons name="alert-circle-outline" size={42} color={theme.color.error} />
        <Text style={{ color: theme.color.onSurface, fontWeight: '700', fontSize: 18, marginTop: 12 }}>{t('could_not_open_reel')}</Text>
        <Text style={{ color: theme.color.onSurface2, textAlign: 'center', marginTop: 8 }}>{loadError || t('project_unavailable')}</Text>
        <Pressable style={styles.errorBack} onPress={() => router.back()}><Text style={{ color: '#fff', fontWeight: '700' }}>{t('go_back')}</Text></Pressable>
      </View>
    );
  }

  const exp = project.export;

  return (
    <View style={styles.root} testID="final-player-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="final-back">
            <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{t('reel_ready')}</Text>
          <Pressable onPress={shareIt} testID="final-share-icon">
            <Ionicons name="share-outline" size={22} color={theme.color.onSurface} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.playerWrap}>
            {url ? (
              <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                nativeControls
                testID="final-video-view"
              />
            ) : (
              <Image source={{ uri: exp.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            )}
            <LinearGradient colors={['rgba(10,11,14,0.5)', 'transparent', 'rgba(10,11,14,0.75)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
            <View style={styles.playerTopBar} pointerEvents="box-none">
              <View style={styles.playerBadge}>
                <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
                <Text style={styles.playerBadgeText}>🎉 READY</Text>
              </View>
              <Pressable style={styles.fsBtn} onPress={() => setFs(true)} testID="final-fullscreen">
                <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
                <Ionicons name="expand" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={styles.metaCard}>
            <Text style={styles.metaHead}>{project.title}</Text>
            <Text style={styles.metaBlurb}>{exp.summary}</Text>
            <View style={styles.metaGrid}>
              <MetaCell label={t('duration_label')} value={`${(exp.duration_seconds || 0).toFixed(1)}s`} />
              <MetaCell label="Resolution" value={exp.resolution} />
              <MetaCell label="Frame rate" value={`${exp.fps} fps`} />
              <MetaCell label={t('aspect_label')} value={exp.aspect_ratio} />
              <MetaCell label={t('size_label')} value={`${exp.size_mb} MB`} />
              <MetaCell label={t('style_label')} value={styleName} />
              <MetaCell label={t('music_label')} value={exp.music?.title || t('none')} />
              <MetaCell label={t('captions_label')} value={exp.captions ? t('on') : t('off')} />
              <MetaCell label={t('render_label')} value={`${exp.render_seconds}s`} />
            </View>
          </View>

          <Pressable
            style={styles.editVideoCta}
            onPress={() => router.push({ pathname: '/project/[id]/export', params: { id: id! } })}
            testID="final-edit-video"
          >
            <View style={styles.editVideoIcon}><Ionicons name="options-outline" size={22} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.editVideoTitle}>{t('edit_this_video')}</Text>
              <Text style={styles.editVideoSubtitle}>{t('edit_video_features')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </Pressable>

          <View style={styles.actionsWrap}>
            {!!actionError && <Text style={styles.actionError} accessibilityRole="alert">{actionError}</Text>}
            <ActionRow>
              <BigAction icon="play" label={t('play')} onPress={() => player.play()} testID="final-play" />
              <BigAction icon="pause" label={t('pause')} onPress={() => player.pause()} testID="final-pause" />
              <BigAction icon="expand" label={t('full')} onPress={() => setFs(true)} testID="final-full" />
              <BigAction icon="share-social" label={t('share')} onPress={shareIt} testID="final-share" />
            </ActionRow>

            <SecActionRow title={t('content')}>
              <SecAction icon="download-outline" label={t('download')} onPress={downloadIt} busy={downloading} testID="final-download" />
              <SecAction icon="cloud-outline" label={t('saved_to_cloud')} onPress={() => Alert.alert(t('saved_to_cloud'), 'Your reel is securely stored with this project.')} testID="final-cloud" />
              <SecAction icon="save-outline" label={t('save_project')} onPress={() => router.push('/(tabs)/projects')} testID="final-save-project" />
            </SecActionRow>

            <SecActionRow title={t('change_regenerate')}>
              <SecAction icon="musical-notes-outline" label={t('change_music')} onPress={() => router.push({ pathname: '/project/[id]/music', params: { id: id!, current: exp.music?.id || '' } })} testID="final-change-music" />
              <SecAction icon="color-palette-outline" label={t('change_style')} onPress={() => cycleStyle(exp.editing_style, rebuild)} testID="final-change-style" />
              <SecAction icon="refresh" label={t('regenerate')} onPress={() => rebuild()} testID="final-regenerate" busy={rebuilding} />
              <SecAction icon="brush-outline" label={t('edit_again')} onPress={() => router.push({ pathname: '/project/[id]/edit-storyboard', params: { id: id! } })} testID="final-edit-again" />
            </SecActionRow>

            <SecActionRow title={t('export_for')}>
              <SecAction icon="logo-instagram" label="Instagram" onPress={() => rebuild({ aspect_ratio: '9:16' })} testID="final-export-ig" />
              <SecAction icon="musical-note" label="TikTok" onPress={() => rebuild({ aspect_ratio: '9:16' })} testID="final-export-tt" />
              <SecAction icon="logo-youtube" label="YouTube video" onPress={() => rebuild({ aspect_ratio: '16:9' })} testID="final-export-yt" />
              <SecAction icon="apps-outline" label={t('more_formats')} onPress={() => setShowFormats(true)} testID="final-more-formats" />
            </SecActionRow>
          </View>
        </ScrollView>

        {rebuilding && (
          <View style={styles.rebuildOverlay} pointerEvents="none">
            <BlurView tint="dark" intensity={30} style={StyleSheet.absoluteFill} />
            <ActivityIndicator color={theme.color.brand} size="large" />
            <Text style={styles.rebuildText}>{t('rendering_video')}</Text>
          </View>
        )}
      </SafeAreaView>

      <Modal visible={fs} animationType="fade" onRequestClose={() => setFs(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0 }}>
            <Pressable style={styles.fsClose} onPress={() => setFs(false)} testID="final-fullscreen-close">
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={showFormats} transparent animationType="slide" onRequestClose={() => setShowFormats(false)}>
        <View style={styles.sheetRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowFormats(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('export_other_format')}</Text>
            {RATIOS.map((r) => (
              <Pressable key={r.id} style={styles.sheetRow}
                onPress={() => { setShowFormats(false); rebuild({ aspect_ratio: r.id.startsWith('9:16') ? '9:16' : r.id }); }}
                testID={`final-format-${r.id}`}>
                <Ionicons name={r.icon} size={20} color={theme.color.brand} />
                <Text style={styles.sheetLabel}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.color.onSurface3} />
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function cycleStyle(current: string | undefined, rebuild: (o: any) => void) {
  const idx = STYLES.indexOf(current || 'cinematic');
  const next = STYLES[(idx + 1) % STYLES.length];
  rebuild({ editing_style: next });
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.mc}>
      <Text style={styles.mcLabel}>{label}</Text>
      <Text style={styles.mcVal} numberOfLines={1}>{value}</Text>
    </View>
  );
}
function ActionRow({ children }: { children: any }) {
  return <View style={styles.actionRow}>{children}</View>;
}
function BigAction({ icon, label, onPress, testID }: any) {
  return (
    <Pressable style={styles.bigAct} onPress={onPress} testID={testID}>
      <Ionicons name={icon} size={22} color={theme.color.brand} />
      <Text style={styles.bigActText}>{label}</Text>
    </Pressable>
  );
}
function SecActionRow({ title, children }: { title: string; children: any }) {
  return (
    <View style={{ marginTop: 20 }}>
      <Text style={styles.secTitle}>{title}</Text>
      <View style={styles.secRow}>{children}</View>
    </View>
  );
}
function SecAction({ icon, label, onPress, testID, busy }: any) {
  return (
    <Pressable style={styles.secAct} onPress={onPress} disabled={busy} testID={testID}>
      {busy ? <ActivityIndicator color={theme.color.brand} /> : <Ionicons name={icon} size={20} color={theme.color.onSurface} />}
      <Text style={styles.secActText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 },
  title: { flex: 1, color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  playerWrap: { marginHorizontal: 20, height: 420, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  playerTopBar: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  playerBadge: { paddingHorizontal: 10, height: 28, borderRadius: theme.radius.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playerBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  fsBtn: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  metaCard: { marginHorizontal: 20, marginTop: 20, padding: 18, borderRadius: theme.radius.lg, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  metaHead: { color: theme.color.onSurface, fontSize: 22, fontWeight: '800', letterSpacing: -0.6 },
  metaBlurb: { color: theme.color.onSurface2, marginTop: 6, fontSize: 13, lineHeight: 18 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, marginHorizontal: -6 },
  editVideoCta: { marginHorizontal: 20, marginTop: 14, minHeight: 72, padding: 14, borderRadius: theme.radius.lg, backgroundColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', gap: 12 },
  editVideoIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  editVideoTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  editVideoSubtitle: { color: 'rgba(255,255,255,0.82)', fontSize: 11, marginTop: 3 },
  mc: { width: '33.333%', paddingHorizontal: 6, marginBottom: 10 },
  mcLabel: { color: theme.color.onSurface3, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  mcVal: { color: theme.color.onSurface, fontSize: 13, fontWeight: '700', marginTop: 3, textTransform: 'capitalize' },
  actionsWrap: { paddingHorizontal: 20, marginTop: 20 },
  actionRow: { flexDirection: 'row', gap: 10 },
  bigAct: { flex: 1, aspectRatio: 1, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center', gap: 6 },
  bigActText: { color: theme.color.onSurface, fontSize: 12, fontWeight: '600' },
  secTitle: { color: theme.color.onSurface3, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4 },
  secRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secAct: { minWidth: '48%', flexGrow: 1, height: 52, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  secActText: { color: theme.color.onSurface, fontWeight: '600', fontSize: 13, flex: 1 },
  rebuildOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12 },
  rebuildText: { color: theme.color.onSurface, fontWeight: '700' },
  actionError: { color: theme.color.error, marginBottom: 14, textAlign: 'center' },
  errorBack: { marginTop: 18, height: 48, paddingHorizontal: 24, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  fsClose: { margin: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: theme.color.surface2, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, padding: 20, paddingBottom: 40 },
  sheetHandle: { alignSelf: 'center', width: 46, height: 4, borderRadius: 2, backgroundColor: theme.color.onSurface3, marginBottom: 16 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: theme.color.divider },
  sheetLabel: { flex: 1, color: theme.color.onSurface, fontWeight: '600' },
});
