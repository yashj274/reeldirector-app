import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';

import { api } from '@/src/api';
import { theme } from '@/src/theme';

export default function Scan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const doScan = async () => {
    if (!cameraRef.current) return;
    setScanning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5, skipProcessing: true });
      if (!photo?.base64) throw new Error('no image');
      const r = await api.scan(photo.base64);
      setResult(r);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      console.warn(e);
    } finally { setScanning(false); }
  };

  if (!permission) return <View style={styles.root} />;
  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center]} testID="scan-permission-screen">
        <Ionicons name="camera-outline" size={48} color={theme.color.onSurface2} />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permSub}>To scan the scene and give AI direction.</Text>
        <Pressable style={styles.permBtn} onPress={requestPermission} testID="scan-grant-permission">
          <Text style={styles.permBtnText}>Grant access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="scan-screen">
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()} testID="scan-back">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.topLabel}>
            <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
            <Text style={styles.topLabelText}>AI Environment Scan</Text>
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
                <Text style={styles.resTitle}>Scene analyzed</Text>
                <Text style={styles.resSummary}>{result.summary}</Text>

                <View style={styles.scores}>
                  <ScoreBar label="Lighting" value={result.lighting_quality_score} />
                  <ScoreBar label="Composition" value={result.composition_score} />
                </View>

                <Text style={styles.resSection}>Suggested shots</Text>
                <ScrollView style={{ maxHeight: 100 }}>
                  {(result.suggested_shots || []).map((s: string, i: number) => (
                    <Text key={i} style={styles.tip}>• {s}</Text>
                  ))}
                </ScrollView>

                <View style={styles.resButtons}>
                  <Pressable style={styles.resGhost} onPress={() => setResult(null)} testID="scan-rescan">
                    <Text style={styles.resGhostText}>Scan again</Text>
                  </Pressable>
                  <Pressable style={styles.resPrimary}
                    onPress={() => router.replace({ pathname: '/project/[id]/camera', params: { id: id!, shot: '0' } })}
                    testID="scan-start-shooting">
                    <Text style={styles.resPrimaryText}>Start shooting</Text>
                    <Ionicons name="arrow-forward" size={16} color="#fff" />
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            <Pressable style={styles.scanBtn} onPress={doScan} disabled={scanning} testID="scan-shutter">
              {scanning ? (
                <>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.scanBtnText}>Analyzing…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="scan" size={22} color="#fff" />
                  <Text style={styles.scanBtnText}>Scan scene</Text>
                </>
              )}
            </Pressable>
          )}
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
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  topLabel: { flex: 1, height: 40, borderRadius: theme.radius.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  topLabelText: { color: '#fff', fontWeight: '700', letterSpacing: 0.5 },
  reticle: { position: 'absolute', top: '30%', left: '15%', right: '15%', bottom: '35%' },
  corner: { position: 'absolute', width: 26, height: 26, borderColor: '#fff' },
  bottomWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16 },
  scanBtn: { flexDirection: 'row', gap: 10, alignSelf: 'center', backgroundColor: theme.color.brand, paddingHorizontal: 28, height: 60, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
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
