import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { api } from '@/src/api';
import { theme } from '@/src/theme';

const SHOT_SIZES = ['extreme_wide', 'wide', 'medium', 'close_up', 'extreme_close_up'];
const MOVES = ['static', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'dolly_in', 'dolly_out', 'tracking', 'orbit', 'reveal', 'handheld'];

export default function EditStoryboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [shots, setShots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenIdx, setRegenIdx] = useState<number | null>(null);
  const [regenNotes, setRegenNotes] = useState('');
  const [regenBusy, setRegenBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const p = await api.getProject(id);
      setShots(p.storyboard || []);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= shots.length) return;
    const next = [...shots];
    [next[i], next[j]] = [next[j], next[i]];
    setShots(next);
  };
  const del = (i: number) => setShots(shots.filter((_, idx) => idx !== i));
  const dup = (i: number) => {
    const next = [...shots];
    next.splice(i + 1, 0, { ...shots[i], status: 'pending' });
    setShots(next);
  };
  const add = () => setShots([...shots, {
    title: 'New Shot', description: 'Describe this shot',
    camera_movement: 'static', shot_size: 'medium',
    duration_seconds: 3.0, direction: 'Hold camera steady', status: 'pending',
  }]);
  const patch = (i: number, key: string, value: any) => {
    const next = [...shots]; next[i] = { ...next[i], [key]: value }; setShots(next);
  };
  const cycle = (i: number, key: string, options: string[]) => {
    const cur = shots[i][key];
    const idx = options.indexOf(cur);
    patch(i, key, options[(idx + 1) % options.length]);
  };

  const save = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateStoryboard(id, shots);
      router.back();
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  const runRegen = async () => {
    if (!id || regenIdx == null) return;
    setRegenBusy(true);
    try {
      const s = await api.regenerateShot(id, regenIdx, regenNotes);
      const next = [...shots]; next[regenIdx] = s; setShots(next);
      setRegenIdx(null); setRegenNotes('');
    } catch (e) { console.warn(e); }
    finally { setRegenBusy(false); }
  };

  if (loading) {
    return <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={theme.color.brand} /></View>;
  }

  return (
    <View style={styles.root} testID="edit-storyboard-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="edit-storyboard-back">
            <Ionicons name="close" size={26} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title}>Customize storyboard</Text>
          <Pressable onPress={save} disabled={saving} testID="edit-storyboard-save">
            {saving ? <ActivityIndicator color={theme.color.brand} /> : <Text style={styles.saveText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {shots.map((s, i) => (
            <View key={i} style={styles.card} testID={`edit-shot-${i}`}>
              <View style={styles.cardTop}>
                <View style={styles.num}><Text style={styles.numText}>{i + 1}</Text></View>
                <TextInput
                  value={s.title}
                  onChangeText={(v) => patch(i, 'title', v)}
                  style={styles.titleInput}
                  testID={`edit-shot-title-${i}`}
                />
                <Pressable onPress={() => { setRegenIdx(i); setRegenNotes(''); }} testID={`edit-shot-regen-${i}`}>
                  <Ionicons name="sparkles" size={20} color={theme.color.brand} />
                </Pressable>
              </View>

              <TextInput
                value={s.description}
                onChangeText={(v) => patch(i, 'description', v)}
                placeholder="Description"
                placeholderTextColor={theme.color.onSurface3}
                multiline
                style={styles.desc}
                testID={`edit-shot-desc-${i}`}
              />

              <View style={styles.metaRow}>
                <Pressable style={styles.metaChip} onPress={() => cycle(i, 'shot_size', SHOT_SIZES)} testID={`edit-shot-size-${i}`}>
                  <Ionicons name="scan-outline" size={13} color={theme.color.brand} />
                  <Text style={styles.metaText}>{s.shot_size?.replace('_', ' ')}</Text>
                </Pressable>
                <Pressable style={styles.metaChip} onPress={() => cycle(i, 'camera_movement', MOVES)} testID={`edit-shot-move-${i}`}>
                  <Ionicons name="videocam-outline" size={13} color={theme.color.brand} />
                  <Text style={styles.metaText}>{s.camera_movement?.replace('_', ' ')}</Text>
                </Pressable>
                <View style={styles.metaChip}>
                  <Ionicons name="time-outline" size={13} color={theme.color.brand} />
                  <TextInput
                    value={String(s.duration_seconds ?? '')}
                    onChangeText={(v) => patch(i, 'duration_seconds', parseFloat(v) || 0)}
                    keyboardType="decimal-pad"
                    style={styles.durInput}
                    testID={`edit-shot-dur-${i}`}
                  />
                  <Text style={styles.metaText}>s</Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <Pressable style={styles.act} onPress={() => move(i, -1)} disabled={i === 0} testID={`edit-shot-up-${i}`}>
                  <Ionicons name="arrow-up" size={16} color={i === 0 ? theme.color.onSurface3 : theme.color.onSurface} />
                </Pressable>
                <Pressable style={styles.act} onPress={() => move(i, 1)} disabled={i === shots.length - 1} testID={`edit-shot-down-${i}`}>
                  <Ionicons name="arrow-down" size={16} color={i === shots.length - 1 ? theme.color.onSurface3 : theme.color.onSurface} />
                </Pressable>
                <Pressable style={styles.act} onPress={() => dup(i)} testID={`edit-shot-dup-${i}`}>
                  <Ionicons name="copy-outline" size={16} color={theme.color.onSurface} />
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable style={[styles.act, { borderColor: theme.color.error }]} onPress={() => del(i)} testID={`edit-shot-del-${i}`}>
                  <Ionicons name="trash-outline" size={16} color={theme.color.error} />
                </Pressable>
              </View>
            </View>
          ))}

          <Pressable style={styles.addBtn} onPress={add} testID="edit-shot-add">
            <Ionicons name="add" size={20} color={theme.color.brand} />
            <Text style={styles.addText}>Add scene</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={regenIdx !== null} transparent animationType="fade" onRequestClose={() => setRegenIdx(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalRoot}>
          <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Regenerate scene {regenIdx != null ? regenIdx + 1 : ''}</Text>
            <Text style={styles.modalSub}>Optional notes to steer the AI.</Text>
            <View style={[styles.desc, { marginTop: 12, minHeight: 90, padding: 12 }]}>
              <TextInput
                value={regenNotes}
                onChangeText={setRegenNotes}
                placeholder="Ex: more dramatic, add golden hour light"
                placeholderTextColor={theme.color.onSurface3}
                multiline
                style={{ color: theme.color.onSurface, fontSize: 15, flex: 1, textAlignVertical: 'top' }}
                autoFocus
                testID="regen-notes-input"
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable style={styles.modalGhost} onPress={() => setRegenIdx(null)} testID="regen-cancel">
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalPrimary} onPress={runRegen} disabled={regenBusy} testID="regen-run">
                {regenBusy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="sparkles" size={16} color="#fff" />
                    <Text style={styles.modalPrimaryText}>Regenerate</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 },
  title: { flex: 1, color: theme.color.onSurface, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  saveText: { color: theme.color.brand, fontWeight: '700' },
  card: { padding: 14, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.color.brandTint, alignItems: 'center', justifyContent: 'center' },
  numText: { color: theme.color.brand, fontWeight: '800' },
  titleInput: { flex: 1, color: theme.color.onSurface, fontWeight: '700', fontSize: 15 },
  desc: { color: theme.color.onSurface2, fontSize: 13, marginTop: 8, backgroundColor: theme.color.surface3, borderRadius: theme.radius.sm, padding: 8, minHeight: 44 },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandTint },
  metaText: { color: theme.color.brand, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  durInput: { color: theme.color.brand, fontSize: 12, fontWeight: '600', minWidth: 30, textAlign: 'center', padding: 0 },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  act: { width: 36, height: 32, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: theme.radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.brand, marginTop: 8 },
  addText: { color: theme.color.brand, fontWeight: '700' },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: theme.color.surface2, borderRadius: theme.radius.lg, padding: 20, borderWidth: 1, borderColor: theme.color.border },
  modalTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: '700' },
  modalSub: { color: theme.color.onSurface2, fontSize: 13, marginTop: 4 },
  modalGhost: { flex: 1, height: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  modalGhostText: { color: theme.color.onSurface, fontWeight: '700' },
  modalPrimary: { flex: 1, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  modalPrimaryText: { color: '#fff', fontWeight: '700' },
});
