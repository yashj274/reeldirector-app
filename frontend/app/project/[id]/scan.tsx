import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { api } from '@/src/api';
import { useT } from '@/src/i18n';
import { theme } from '@/src/theme';

const MAX_SCAN_FRAMES = 2;

export default function Scan() {
  const { id } = useLocalSearchParams<{ id: string; flow?: string }>();
  const router = useRouter();
  const t = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [framesCaptured, setFramesCaptured] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [scanError, setScanError] = useState('');
  const scanActiveRef = useRef(false);
  const scanFramesRef = useRef<string[]>([]);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureTaskRef = useRef<Promise<void> | null>(null);

  useEffect(() => { if (id) api.getProject(id).then(setProject).catch(() => {}); }, [id]);
  useEffect(() => () => {
    scanActiveRef.current = false;
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
  }, []);

  const startScan = () => {
    if (!cameraRef.current || !cameraReady || !id || scanning || analyzing) return;
    scanFramesRef.current = [];
    setFramesCaptured(0);
    setResult(null);
    setScanError('');
    scanActiveRef.current = true;
    setScanning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const captureNext = async () => {
      try {
        const photo = await cameraRef.current?.takePictureAsync({ quality: 0.45, skipProcessing: true });
        if (photo?.uri) {
          const resized = await manipulateAsync(
            photo.uri,
            [{ resize: { width: 512 } }],
            { compress: 0.6, format: SaveFormat.JPEG, base64: true },
          );
          if (resized.base64) scanFramesRef.current = [...scanFramesRef.current, resized.base64].slice(-MAX_SCAN_FRAMES);
          setFramesCaptured(scanFramesRef.current.length);
        }
      } catch (error) {
        console.warn('Environment scan frame capture failed:', error);
        if (!scanFramesRef.current.length) setScanError('Could not capture a view. Check camera access and try again.');
      }
      if (scanActiveRef.current && scanFramesRef.current.length < MAX_SCAN_FRAMES) {
        scanTimerRef.current = setTimeout(() => {
          const nextCapture = captureNext();
          captureTaskRef.current = nextCapture;
          void nextCapture;
        }, 650);
      }
    };
    const firstCapture = captureNext();
    captureTaskRef.current = firstCapture;
    void firstCapture;
  };

  const stopScan = async () => {
    if (!scanning || analyzing) return;
    scanActiveRef.current = false;
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null;
    setScanning(false);
    setAnalyzing(true);
    if (captureTaskRef.current) await captureTaskRef.current;
    captureTaskRef.current = null;
    const frames = scanFramesRef.current;
    if (!frames.length || !id) {
      setScanError('Hold the camera steady for a moment so the scan can capture a view, then try again.');
      setAnalyzing(false);
      return;
    }
    setScanError('');
    try {
      const r = await api.scan(id, frames[frames.length - 1], frames);
      setResult(r);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error) {
      console.warn(error);
      setScanError(error instanceof Error ? error.message : 'Could not analyze this scene. Try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const continueFromScan = async () => {
    if (!id) return;
    const hasRecordedClips = (project?.clips || []).length > 0;
    if (project?.storyboard?.length && hasRecordedClips) {
      const recorded = new Set((project.clips || []).map((clip: any) => Number(clip.shot_index)));
      const nextShot = (project.storyboard || []).findIndex((_shot: any, index: number) => !recorded.has(index));
      router.replace({ pathname: '/project/[id]/camera', params: { id, shot: String(Math.max(0, nextShot)) } });
      return;
    }
    setGenerating(true);
    setScanError('');
    try {
      await api.storyboard(id, true);
      router.replace(`/project/${id}`);
    } catch (error: any) {
      setScanError(error?.message || 'Could not write the custom script. Try again.');
    } finally { setGenerating(false); }
  };

  const skipScan = () => router.replace(`/project/${id}`);

  if (!permission) return <View style={styles.root} />;
  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center]} testID="scan-permission-screen">
        <Ionicons name="camera-outline" size={48} color={theme.color.onSurface2} />
        <Text style={styles.permTitle}>{t('camera_access_needed')}</Text>
        <Text style={styles.permSub}>{t('scan_permission')}</Text>
        {!!scanError && <Text style={styles.error}>{scanError}</Text>}
        <Pressable style={styles.permBtn} onPress={requestPermission} testID="scan-grant-permission">
          <Text style={styles.permBtnText}>{t('grant_access')}</Text>
        </Pressable>
        <Pressable onPress={skipScan} testID="scan-skip-permission"><Text style={styles.skipText}>{t('skip_scan')}</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="scan-screen">
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setCameraReady(true)} />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()} testID="scan-back">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.topLabel}>
            <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
            <Text style={styles.topLabelText}>{t('environment_scan')}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.reticle} pointerEvents="none">
          <View style={[styles.corner, { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 }]} />
          <View style={[styles.corner, { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 }]} />
          <View style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 }]} />
          <View style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 }]} />
        </View>

        <View style={styles.bottomWrap}>
          {result ? (
            <View style={styles.resultSheet}>
              <BlurView tint="dark" intensity={60} style={StyleSheet.absoluteFill} />
              <View style={{ padding: 20 }}>
                <Text style={styles.resTitle}>{t('scene_analyzed')}</Text>
                {!project?.storyboard?.length && <Text style={styles.scanExplain}>{t('scan_explainer')}</Text>}
                <Text style={styles.resSummary}>{result.summary}</Text>

                <View style={styles.scores}>
                  <ScoreBar label={t('lighting')} value={result.lighting_quality_score} />
                  <ScoreBar label={t('composition')} value={result.composition_score} />
                </View>

                <Text style={styles.resSection}>{t('suggested_shots')}</Text>
                <ScrollView style={{ maxHeight: 100 }}>
                  {(result.suggested_shots || []).map((s: string, i: number) => (
                    <Text key={i} style={styles.tip}>• {s}</Text>
                  ))}
                </ScrollView>

                <View style={styles.resButtons}>
                  <Pressable style={styles.resGhost} onPress={() => setResult(null)} testID="scan-rescan">
                    <Text style={styles.resGhostText}>{t('scan_again')}</Text>
                  </Pressable>
                  <Pressable style={styles.resPrimary}
                    onPress={() => void continueFromScan()}
                    disabled={generating}
                    testID="scan-continue">
                    {generating ? <ActivityIndicator color="#fff" /> : <Text style={styles.resPrimaryText}>
                      {project?.storyboard?.length && (project?.clips || []).length > 0 ? t('start_shooting') : t('generate_script')}
                    </Text>}
                    {!generating && <Ionicons name="arrow-forward" size={16} color="#fff" />}
                  </Pressable>
                </View>
                {!!scanError && <Text style={styles.error}>{scanError}</Text>}
              </View>
            </View>
          ) : analyzing ? (
            <View style={styles.scanStatus} testID="scan-analyzing">
              <ActivityIndicator color="#fff" />
              <Text style={styles.scanBtnText}>{t('analyzing_scene')}</Text>
            </View>
          ) : scanning ? (
            <View style={styles.scanControls}>
              <Text style={styles.scanCount}>{t('scan_views_captured').replace('{count}', String(framesCaptured))}</Text>
              <Pressable style={[styles.scanBtn, styles.stopBtn]} onPress={() => void stopScan()} testID="scan-stop">
                <Ionicons name="stop" size={20} color="#fff" />
                <Text style={styles.scanBtnText}>{t('scan_stop')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.scanControls}>
              <Pressable style={[styles.scanBtn, !cameraReady && { opacity: 0.65 }]} onPress={startScan} disabled={!cameraReady} testID="scan-start">
                {!cameraReady ? <ActivityIndicator color="#fff" /> : <Ionicons name="scan" size={22} color="#fff" />}
                <Text style={styles.scanBtnText}>{cameraReady ? t('scan_start') : t('starting_camera')}</Text>
              </Pressable>
              <Text style={styles.scanCount}>{t('scan_capture_hint')}</Text>
            </View>
          )}
          {!result && !scanning && !analyzing && <Text style={styles.scanIntro}>{t('scan_explainer')}</Text>}
          {!!scanError && !result && <Text style={styles.error}>{scanError}</Text>}
          {!result && <Pressable onPress={skipScan} testID="scan-skip"><Text style={styles.skipText}>{t('skip_scan')}</Text></Pressable>}
        </View>
      </SafeAreaView>
    </View>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.scoreLabel}>{label}</Text>
        <Text style={styles.scoreVal}>{Math.round(v)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${v}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  permTitle: { color: theme.color.onSurface, fontSize: 20, fontWeight: '700', marginTop: 12 },
  permSub: { color: theme.color.onSurface2, textAlign: 'center' },
  permBtn: { marginTop: 20, backgroundColor: theme.color.brand, paddingHorizontal: 20, height: 48, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  permBtnText: { color: '#fff', fontWeight: '700' },
  scanIntro: { color: 'rgba(255,255,255,0.75)', fontSize: 12, textAlign: 'center', marginTop: 10, marginHorizontal: 20 },
  scanExplain: { color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 17, marginTop: 6 },
  skipText: { color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 10 },
  error: { color: '#fff', backgroundColor: 'rgba(180,30,60,0.85)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.md, textAlign: 'center', marginTop: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  topLabel: { flex: 1, height: 40, borderRadius: theme.radius.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  topLabelText: { color: '#fff', fontWeight: '700', letterSpacing: 0.5 },
  reticle: { position: 'absolute', top: '30%', left: '15%', right: '15%', bottom: '35%' },
  corner: { position: 'absolute', width: 26, height: 26, borderColor: '#fff' },
  bottomWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16 },
  scanControls: { alignItems: 'center', gap: 10 },
  scanCount: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  scanStatus: { flexDirection: 'row', gap: 10, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 22, height: 54, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  scanBtn: { flexDirection: 'row', gap: 10, alignSelf: 'center', backgroundColor: theme.color.brand, paddingHorizontal: 28, height: 60, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  stopBtn: { backgroundColor: '#A82537' },
  scanBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resultSheet: { borderRadius: theme.radius.lg, overflow: 'hidden' },
  resTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  resSummary: { color: 'rgba(255,255,255,0.9)', marginTop: 6, fontSize: 14 },
  scores: { marginTop: 12 },
  scoreLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  scoreVal: { color: '#fff', fontSize: 12, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, marginTop: 6, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: theme.color.brand },
  resSection: { color: '#fff', fontWeight: '700', marginTop: 16, marginBottom: 6 },
  tip: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginBottom: 4 },
  resButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  resGhost: { flex: 1, height: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  resGhostText: { color: '#fff', fontWeight: '700' },
  resPrimary: { flex: 1, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  resPrimaryText: { color: '#fff', fontWeight: '700' },
});
