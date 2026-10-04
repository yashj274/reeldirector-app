import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { ClipVideoPreview } from '@/src/ClipVideoPreview';
import { useT } from '@/src/i18n';

export default function ProjectDetail() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [proj, setProj] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [storyboardNotice, setStoryboardNotice] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try { setProj(await api.getProject(id)); } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const doStoryboard = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      const result = await api.storyboard(id);
      await load();
      setStoryboardNotice(result?.ai_generated === false
        ? 'Gemini did not return an AI script. This version is built around your description and available scene scan; you can retry the AI version when the service responds.'
        : '');
    } catch (e: any) {
      console.warn(e);
      setStoryboardNotice(e.message || 'Could not create a storyboard. Please try again.');
    }
    finally { setGenerating(false); }
  };

  const retakeShot = async (shotIndex: number) => {
    if (!id) return;
    try {
      await api.retakeShot(id, shotIndex);
      await load();
    } catch (e: any) {
      Alert.alert('Could not retake shot', e.message || 'Please try again.');
    }
  };

  if (loading || !proj) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.color.brand} />
      </View>
    );
  }

  const captured = (proj.storyboard || []).filter((s: any) => s.status === 'captured').length;
  const total = (proj.storyboard || []).length;

  return (
    <View style={styles.root} testID="project-detail-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="project-back">
            <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.hdrTitle} numberOfLines={1}>{proj.title}</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>{proj.shoot_type.toUpperCase()} · {proj.style.toUpperCase()}</Text>
            <Text style={styles.metaTitle}>{proj.mood} · {proj.duration_seconds}s</Text>
            <Text style={styles.metaSub}>{proj.purpose || t('no_purpose')}</Text>
          </View>
          {(storyboardNotice || proj.storyboard_ai_generated === false) && (
            <View style={styles.storyboardNoticeBox} accessibilityRole="alert">
              <Text style={styles.storyboardNotice}>
                {storyboardNotice || 'Gemini did not return an AI script. This version is built around your description and available scene scan.'}
              </Text>
              {(proj.storyboard || []).every((shot: any) => shot.status !== 'captured') && (
                <Pressable onPress={doStoryboard} disabled={generating} style={styles.retryStoryboard} testID="project-retry-ai-storyboard">
                  {generating ? <ActivityIndicator size="small" color={theme.color.brand} /> : <Ionicons name="refresh" size={16} color={theme.color.brand} />}
                  <Text style={styles.retryStoryboardText}>{generating ? t('directing_your_shoot') : 'Retry AI custom script'}</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Storyboard section */}
          {!proj.storyboard ? (
            <Pressable style={styles.bigCta} onPress={doStoryboard} disabled={generating} testID="project-generate-storyboard">
              <LinearGradient colors={[theme.color.brand, theme.color.brandDim]} style={StyleSheet.absoluteFill} />
              <View style={styles.bigCtaInner}>
                {generating ? <ActivityIndicator color="#fff" /> : <Ionicons name="sparkles" size={22} color="#fff" />}
                <Text style={styles.bigCtaText}>{generating ? t('directing_your_shoot') : t('generate_storyboard')}</Text>
              </View>
            </Pressable>
          ) : (
            <>
              {!!proj.scene_map?.summary && (
                <View style={styles.scanCard}>
                  <Text style={styles.scanLabel}>{t('scene_scan_label')}</Text>
                  <Text style={styles.scanSummary}>{proj.scene_map.summary}</Text>
                  {proj.scene_map.ai_generated === false && <Text style={styles.scanFallback}>{t('scan_fallback')}</Text>}
                </View>
              )}
              {!!proj.script && (
                <View style={styles.scriptCard}>
                  <Text style={styles.scriptLabel}>{t('custom_script')}</Text>
                  <Text style={styles.scriptText}>{proj.script}</Text>
                </View>
              )}
              <View style={styles.progressRow}>
                <Text style={styles.sectionTitle}>{t('storyboard')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Pressable onPress={() => router.push({ pathname: '/project/[id]/edit-storyboard', params: { id: id! } })} testID="project-customize-storyboard">
                    <Ionicons name="options-outline" size={20} color={theme.color.brand} />
                  </Pressable>
                  <Text style={styles.progress}>{captured}/{total} shots</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: total ? `${(captured / total) * 100}%` : '0%' }]} />
              </View>

              <View style={{ gap: 10, marginTop: 16 }}>
                {(proj.storyboard || []).map((s: any) => {
                  const clip = (proj.clips || []).find((item: any) => item.shot_index === s.index);
                  return (
                  <View key={s.index} style={styles.shot} testID={`shot-card-${s.index}`}>
                    <View style={styles.shotNum}>
                      <Text style={styles.shotNumText}>{s.index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shotTitle}>{s.title}</Text>
                      <Text style={styles.shotDesc} numberOfLines={2}>{s.description}</Text>
                      {!!s.narration && <Text style={styles.shotNarration}>{s.narration}</Text>}
                      {!!s.on_screen_text && <Text style={styles.shotCaption}>{s.on_screen_text}</Text>}
                      <View style={styles.shotTags}>
                        <Text style={styles.shotTag}>{(s.shot_size || '').replace('_', ' ')}</Text>
                        <Text style={styles.shotTag}>{(s.camera_movement || '').replace('_', ' ')}</Text>
                        <Text style={styles.shotTag}>{s.duration_seconds?.toFixed?.(1) ?? s.duration_seconds}s</Text>
                      </View>
                      {clip && (
                        <View style={styles.clipReview}>
                          <Text style={styles.clipReviewLabel}>Recorded clip · {Number(clip.duration_seconds || 0).toFixed(1)}s</Text>
                          <ClipVideoPreview uri={clip.video_url} posterUri={clip.frame_url} height={190} />
                          <Pressable
                            style={styles.clipEditButton}
                            onPress={() => router.push({ pathname: '/project/[id]/export', params: { id: id!, clip: String(s.index) } })}
                            testID={`shot-edit-${s.index}`}
                          >
                            <Ionicons name="options-outline" size={16} color={theme.color.brand} />
                            <Text style={styles.clipEditText}>Preview & edit this clip</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                    <View style={{ alignItems: 'center', gap: 8 }}>
                      {s.status === 'captured' && <Ionicons name="checkmark-circle" size={22} color={theme.color.success} />}
                      {s.status === 'retake' && <Ionicons name="refresh-circle" size={22} color={theme.color.warning} />}
                      {(s.status === 'captured' || s.status === 'retake') && (
                        <Pressable onPress={() => retakeShot(s.index)} testID={`shot-retake-${s.index}`} style={{ padding: 4 }}>
                          <Ionicons name="reload-outline" size={18} color={theme.color.brand} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                  );
                })}
              </View>

              <Pressable style={styles.actionBtn}
                onPress={() => router.push({ pathname: '/project/[id]/scan', params: { id: id! } })}
                testID="project-open-scanner">
                <Ionicons name="scan-outline" size={18} color={theme.color.brand} />
                <Text style={styles.actionText}>{t('scene_scan_label')}</Text>
              </Pressable>

              <Pressable style={styles.primary}
                onPress={() => router.push({ pathname: '/project/[id]/camera', params: { id: id!, shot: '0' } })}
                testID="project-start-shooting">
                <Ionicons name="videocam" size={18} color="#fff" />
                <Text style={styles.primaryText}>{captured === 0 ? t('start_shooting') : captured < total ? t('continue_shooting') : t('reshoot')}</Text>
              </Pressable>

              {captured >= 1 && (
                <>
                  <Pressable style={[styles.primary, { backgroundColor: theme.color.surface3, borderWidth: 1, borderColor: theme.color.borderStrong }]}
                    onPress={() => router.push({ pathname: '/project/[id]/final', params: { id: id! } })}
                    testID="project-goto-final">
                    <Ionicons name="play-circle" size={18} color={theme.color.onSurface} />
                    <Text style={[styles.primaryText, { color: theme.color.onSurface }]}>{t('preview_final_reel')}</Text>
                  </Pressable>
                  <Pressable style={[styles.primary, { backgroundColor: theme.color.surface3, borderWidth: 1, borderColor: theme.color.borderStrong }]}
                    onPress={() => router.push({ pathname: '/project/[id]/export', params: { id: id! } })}
                    testID="project-goto-export">
                    <Ionicons name="rocket-outline" size={18} color={theme.color.onSurface} />
                    <Text style={[styles.primaryText, { color: theme.color.onSurface }]}>{t('edit_video_export')}</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 },
  hdrTitle: { flex: 1, color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  metaCard: { padding: 20, borderRadius: theme.radius.lg, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, marginBottom: 20 },
  storyboardNoticeBox: { marginTop: -8, marginBottom: 18, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, gap: 10 },
  storyboardNotice: { color: theme.color.onSurface2, fontSize: 13, lineHeight: 19 },
  retryStoryboard: { minHeight: 38, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderRadius: theme.radius.md, backgroundColor: theme.color.brandTint },
  retryStoryboardText: { color: theme.color.brand, fontSize: 13, fontWeight: '700' },
  metaLabel: { color: theme.color.brand, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  metaTitle: { color: theme.color.onSurface, fontSize: 22, fontWeight: '700', marginTop: 8, letterSpacing: -0.5 },
  metaSub: { color: theme.color.onSurface2, marginTop: 6, fontSize: 14 },
  scanCard: { marginTop: 12, marginBottom: 10, padding: 15, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  scanLabel: { color: theme.color.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  scanSummary: { color: theme.color.onSurface, fontSize: 14, lineHeight: 20, marginTop: 6 },
  scanFallback: { color: theme.color.onSurface3, fontSize: 11, marginTop: 5 },
  scriptCard: { marginTop: 12, padding: 15, borderRadius: theme.radius.md, backgroundColor: theme.color.brandTint, borderWidth: 1, borderColor: theme.color.border },
  scriptLabel: { color: theme.color.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  scriptText: { color: theme.color.onSurface, fontSize: 14, lineHeight: 21, marginTop: 7 },
  bigCta: { height: 84, borderRadius: theme.radius.lg, overflow: 'hidden' },
  bigCtaInner: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  bigCtaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  sectionTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  progress: { color: theme.color.onSurface2, fontSize: 13, fontWeight: '600' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: theme.color.surface3, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: theme.color.brand },
  shot: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, alignItems: 'flex-start' },
  shotNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.color.brandTint, alignItems: 'center', justifyContent: 'center' },
  shotNumText: { color: theme.color.brand, fontWeight: '700' },
  shotTitle: { color: theme.color.onSurface, fontWeight: '700', fontSize: 15 },
  shotDesc: { color: theme.color.onSurface2, fontSize: 13, marginTop: 4 },
  shotNarration: { color: theme.color.onSurface, fontSize: 12, lineHeight: 18, marginTop: 6, fontStyle: 'italic' },
  shotCaption: { color: theme.color.brand, fontSize: 11, marginTop: 5, fontWeight: '700' },
  shotTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  shotTag: { color: theme.color.onSurface3, fontSize: 11, backgroundColor: theme.color.surface3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill, textTransform: 'capitalize' },
  clipReview: { marginTop: 12, gap: 8 },
  clipReviewLabel: { color: theme.color.onSurface3, fontSize: 11, fontWeight: '700' },
  clipEditButton: { minHeight: 38, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brandTint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  clipEditText: { color: theme.color.brand, fontSize: 12, fontWeight: '700' },
  actionBtn: { marginTop: 20, height: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brandTint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionText: { color: theme.color.brand, fontWeight: '700' },
  primary: { marginTop: 12, height: 56, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
