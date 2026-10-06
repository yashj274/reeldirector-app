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
  const [projectLoadError, setProjectLoadError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [startingShooting, setStartingShooting] = useState(false);
  const [storyboardNotice, setStoryboardNotice] = useState('');
  const [focusedShotIndex, setFocusedShotIndex] = useState(0);
  const [updatingShot, setUpdatingShot] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setProjectLoadError('');
    try {
      const project = await api.getProject(id);
      setProj(project);
      const clips = new Set((project.clips || []).map((clip: any) => Number(clip.shot_index)));
      const next = (project.storyboard || []).findIndex((shot: any, index: number) =>
        !clips.has(index) || shot.status === 'retake');
      if (next >= 0) setFocusedShotIndex(next);
    } catch (e: any) {
      console.warn(e);
      setProjectLoadError(e?.message || t('project_load_failed'));
    }
    finally { setLoading(false); }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  const doStoryboard = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      const result = await api.storyboard(id, true);
      await load();
      setStoryboardNotice(result?.preserved_existing
        ? t('storyboard_preserved')
        : result?.ai_generated === false
          ? 'This script is tailored to your description and the scene scan, if available. You can edit every shot or retry the AI custom script.'
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

  const toggleSkipped = async () => {
    if (!id || updatingShot) return;
    const shot = proj?.storyboard?.[focusedShotIndex];
    if (!shot) return;
    setUpdatingShot(true);
    try {
      await api.setShotSkipped(id, focusedShotIndex, shot.status !== 'skipped');
      await load();
    } catch (error: any) {
      Alert.alert('Could not update this shot', error?.message || 'Please try again.');
    } finally { setUpdatingShot(false); }
  };

  const startShooting = async () => {
    if (!id || startingShooting) return;
    let targetProject = proj;
    const needsCompletePlan = (proj.storyboard || []).length > 0 && (proj.storyboard || []).length < 4
      && proj.storyboard_ai_generated !== false && proj.storyboard_user_edited !== true
      && !(proj.clips || []).length;
    if (needsCompletePlan) {
      setStartingShooting(true);
      try {
        await api.storyboard(id, true);
        targetProject = await api.getProject(id);
        setProj(targetProject);
      } catch (error: any) {
        Alert.alert('Could not finish the shot plan', error?.message || 'Please try again.');
        setStartingShooting(false);
        return;
      }
      setStartingShooting(false);
    }
    const saved = new Set((targetProject.clips || []).map((clip: any) => Number(clip.shot_index)));
    const isAvailable = (index: number) => targetProject.storyboard?.[index]?.status !== 'skipped'
      && (!saved.has(index) || targetProject.storyboard?.[index]?.status === 'retake');
    const focused = isAvailable(focusedShotIndex) ? focusedShotIndex : -1;
    const pending = (targetProject.storyboard || []).findIndex((_shot: any, index: number) => isAvailable(index));
    if (pending < 0 && saved.size === 0) {
      Alert.alert(t('shot_plan'), t('all_shots_skipped'));
      return;
    }
    router.push({ pathname: '/project/[id]/camera', params: { id, shot: String(focused >= 0 ? focused : Math.max(0, pending)) } });
  };

  if (loading && !proj) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.color.brand} />
      </View>
    );
  }
  if (!proj) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
        <Text style={styles.projectLoadError}>{projectLoadError || 'Could not open this project.'}</Text>
        <Pressable style={styles.retryStoryboard} onPress={() => void load()} testID="project-load-retry">
          <Ionicons name="refresh" size={16} color={theme.color.brand} />
          <Text style={styles.retryStoryboardText}>{t('try_again')}</Text>
        </Pressable>
      </View>
    );
  }

  const captured = (proj.storyboard || []).filter((s: any) => s.status === 'captured').length;
  const skipped = (proj.storyboard || []).filter((s: any) => s.status === 'skipped').length;
  const total = (proj.storyboard || []).length;
  const finishedCount = Math.min(total, captured + skipped);
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
          {proj.local_recovery && (
            <View style={styles.recoveryNotice} testID="project-local-recovery">
              <Text style={styles.recoveryText}>
                {proj.local_sync_conflict
                  ? t('local_recovery_conflict')
                  : proj.local_sync_pending ? t('local_recovery_pending') : t('local_recovery_offline')}
              </Text>
              {!proj.local_sync_conflict && (
                <Pressable onPress={() => void load()} style={styles.recoveryRetry} testID="project-sync-retry">
                  <Ionicons name="refresh" size={15} color={theme.color.brand} />
                  <Text style={styles.retryStoryboardText}>{t('sync_try_again')}</Text>
                </Pressable>
              )}
            </View>
          )}
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>{proj.shoot_type.toUpperCase()} · {proj.style.toUpperCase()}</Text>
            <Text style={styles.metaTitle}>{proj.mood} · {proj.duration_seconds}s</Text>
            <Text style={styles.metaSub}>{proj.purpose || t('no_purpose')}</Text>
          </View>
          {(storyboardNotice || proj.storyboard_ai_generated === false) && (
            <View style={styles.storyboardNoticeBox} accessibilityRole="alert">
              <Text style={styles.storyboardNotice}>
                {storyboardNotice || 'This script is tailored to your description and the scene scan, if available. You can edit every shot or retry the AI custom script.'}
              </Text>
              {captured > 0 && <Text style={styles.retryStoryboardHelp}>Your {captured} recorded {captured === 1 ? 'clip stays' : 'clips stay'} saved and linked by shot number. Review them against the refreshed shot list.</Text>}
              <Pressable onPress={doStoryboard} disabled={generating} style={styles.retryStoryboard} testID="project-retry-ai-storyboard">
                {generating ? <ActivityIndicator size="small" color={theme.color.brand} /> : <Ionicons name="refresh" size={16} color={theme.color.brand} />}
                <Text style={styles.retryStoryboardText}>{generating ? t('directing_your_shoot') : 'Retry AI custom script'}</Text>
              </Pressable>
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
                <View style={[styles.progressFill, { width: total ? `${(finishedCount / total) * 100}%` : '0%' }]} />
              </View>

              <Text style={styles.timelineTitle}>{t('shot_plan')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeline}>
                {(proj.storyboard || []).map((shot: any, index: number) => {
                  const hasClip = (proj.clips || []).some((clip: any) => Number(clip.shot_index) === index);
                  const status = shot.status === 'skipped' ? 'shot_skipped'
                    : shot.status === 'retake' ? 'shot_retake'
                    : shot.status === 'captured' || hasClip ? 'shot_done'
                      : index === focusedShotIndex ? 'shot_current' : 'shot_upcoming';
                  const phase = ['hook', 'detail', 'action', 'hero', 'cta'].includes(shot.purpose)
                    ? `phase_${shot.purpose}` : `phase_${['hook', 'detail', 'action', 'hero', 'cta'][Math.min(index, 4)]}`;
                  return (
                    <Pressable key={`timeline-${index}`} onPress={() => setFocusedShotIndex(index)}
                      style={[styles.timelineStep, index === focusedShotIndex && styles.timelineStepOn]}
                      accessibilityRole="button" accessibilityState={{ selected: index === focusedShotIndex }}
                      testID={`storyboard-timeline-shot-${index}`}>
                      <View style={styles.timelineStepTop}>
                        <Text style={[styles.timelineNumber, index === focusedShotIndex && styles.timelineTextOn]}>{index + 1}</Text>
                        <Text style={[styles.timelineStatus, shot.status === 'retake' && { color: theme.color.warning }]}>{t(status)}</Text>
                      </View>
                      <Text style={styles.timelinePhase}>{t(phase)}</Text>
                      <Text numberOfLines={1} style={styles.timelineMovement}>{t(`move_${shot.camera_movement || 'static'}`)} · {shot.duration_seconds}s</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {proj.storyboard?.[focusedShotIndex] && (
                <View style={styles.focusedShot} testID="storyboard-timeline-detail">
                  <Text style={styles.focusedShotTitle}>{proj.storyboard[focusedShotIndex].title}</Text>
                  <Text style={styles.focusedShotInstruction}>
                    {String(proj.storyboard[focusedShotIndex].instruction || proj.storyboard[focusedShotIndex].direction || proj.storyboard[focusedShotIndex].description || '').split(/[.!?]/, 1)[0].split(/\s+/).slice(0, 12).join(' ')}
                  </Text>
                  {!(proj.clips || []).some((clip: any) => Number(clip.shot_index) === focusedShotIndex) && (
                    <Pressable onPress={() => void toggleSkipped()} disabled={updatingShot}
                      style={styles.skipShotButton} testID="storyboard-toggle-skipped">
                      {updatingShot ? <ActivityIndicator size="small" color={theme.color.brand} /> : null}
                      <Text style={styles.skipShotText}>{proj.storyboard[focusedShotIndex].status === 'skipped' ? t('include_shot') : t('skip_shot')}</Text>
                    </Pressable>
                  )}
                </View>
              )}

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
                      <Text style={styles.shotDesc} numberOfLines={2}>{s.instruction || s.direction || s.description}</Text>
                      {!!s.narration && <Text style={styles.shotNarration}>{s.narration}</Text>}
                      {!!s.on_screen_text && <Text style={styles.shotCaption}>{s.on_screen_text}</Text>}
                      <View style={styles.shotTags}>
                        <Text style={styles.shotTag}>{t(`move_${s.camera_movement || 'static'}`)}</Text>
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

              <Pressable style={[styles.primary, startingShooting && { opacity: 0.7 }]}
                onPress={() => void startShooting()}
                disabled={startingShooting}
                testID="project-start-shooting">
                {startingShooting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="videocam" size={18} color="#fff" />}
                <Text style={styles.primaryText}>{startingShooting ? t('prepare_scenes') : captured === 0 ? t('start_shooting') : captured < total ? t('continue_shooting') : t('reshoot')}</Text>
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
  projectLoadError: { color: theme.color.onSurface2, textAlign: 'center', fontSize: 14, lineHeight: 21, marginBottom: 12 },
  recoveryNotice: { padding: 12, marginBottom: 14, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, gap: 8 },
  recoveryText: { color: theme.color.onSurface2, fontSize: 12, lineHeight: 17 },
  recoveryRetry: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 },
  hdrTitle: { flex: 1, color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  metaCard: { padding: 20, borderRadius: theme.radius.lg, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, marginBottom: 20 },
  storyboardNoticeBox: { marginTop: -8, marginBottom: 18, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, gap: 10 },
  storyboardNotice: { color: theme.color.onSurface2, fontSize: 13, lineHeight: 19 },
  retryStoryboardHelp: { color: theme.color.onSurface3, fontSize: 12, lineHeight: 17 },
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
  timelineTitle: { color: theme.color.onSurface2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginTop: 20, marginBottom: 10 },
  timeline: { gap: 8, paddingBottom: 2 },
  timelineStep: { width: 132, minHeight: 82, padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, justifyContent: 'space-between' },
  timelineStepOn: { borderColor: theme.color.brand, backgroundColor: theme.color.brandTint },
  timelineStepTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timelineNumber: { color: theme.color.onSurface2, fontSize: 12, fontWeight: '800' },
  timelineTextOn: { color: theme.color.brand },
  timelineStatus: { color: theme.color.onSurface3, fontSize: 10, fontWeight: '700' },
  timelinePhase: { color: theme.color.onSurface, fontSize: 14, fontWeight: '700', marginTop: 7 },
  timelineMovement: { color: theme.color.onSurface3, fontSize: 10, marginTop: 2 },
  focusedShot: { padding: 13, marginTop: 10, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  focusedShotTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: '700' },
  focusedShotInstruction: { color: theme.color.onSurface2, fontSize: 13, lineHeight: 18, marginTop: 5 },
  skipShotButton: { alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 10, marginTop: 10, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.color.border, flexDirection: 'row', alignItems: 'center', gap: 7 },
  skipShotText: { color: theme.color.brand, fontSize: 12, fontWeight: '700' },
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
