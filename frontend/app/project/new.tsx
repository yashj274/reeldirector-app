import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { api } from '@/src/api';
import { theme } from '@/src/theme';

const DEFAULT_TYPES = [
  'wedding', 'travel', 'food', 'fashion', 'gym', 'product', 'real_estate',
  'cafe', 'restaurant', 'event', 'documentary', 'business', 'lifestyle',
  'daily_vlog', 'social_media', 'cinematic',
];
const label = (id: string) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const MOODS = ['Cinematic', 'Emotional', 'Energetic', 'Luxury', 'Minimal', 'Warm'];
const DURATIONS = [15, 20, 30, 45, 60];
const PLATFORMS = [
  { id: 'instagram_reel', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube_shorts', label: 'YouTube' },
];

export default function NewProject() {
  const router = useRouter();
  const params = useLocalSearchParams<{ template?: string; mood?: string; style?: string; duration?: string }>();

  const [title, setTitle] = useState('');
  const [types, setTypes] = useState<string[]>(DEFAULT_TYPES);
  const [shootType, setShootType] = useState<string>(params.template || 'travel');
  const [mood, setMood] = useState<string>(params.mood?.split(' ')[0] || 'Cinematic');
  const [duration, setDuration] = useState<number>(params.duration ? parseInt(params.duration) : 30);
  const [platform, setPlatform] = useState<string>('instagram_reel');
  const [audience, setAudience] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');

  const canSubmit = useMemo(() => title.trim().length >= 2, [title]);

  const addCustom = () => {
    const raw = customName.trim();
    if (raw.length < 2) return;
    const id = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!types.includes(id)) setTypes([id, ...types]);
    setShootType(id);
    setCustomName('');
    setCustomOpen(false);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setCreateError('');
    setBusy(true);
    try {
      const p = await api.createProject({
        title: title.trim(), shoot_type: shootType, purpose, mood, duration_seconds: duration,
        style: (params.style as string) || 'cinematic', platform, audience,
      });
      router.replace(`/project/${p.id}`);
    } catch (e: any) {
      console.warn('Project creation failed:', e);
      const message = typeof e?.message === 'string' ? e.message : '';
      setCreateError(/failed to fetch|network request failed|load failed/i.test(message)
        ? 'Could not reach Supabase. Check your phone’s internet connection and try again.'
        : message || 'Could not create the project. Please try again.');
    }
    finally { setBusy(false); }
  };

  const chip = (active: boolean, txt: string, onPress: () => void, testID: string, extraStyle?: any) => (
    <Pressable key={testID} onPress={onPress} style={[styles.chip, extraStyle, active && styles.chipOn]} testID={testID}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{txt}</Text>
    </Pressable>
  );

  return (
    <View style={styles.root} testID="new-project-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="new-project-back">
            <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title}>New Reel</Text>
          <View style={{ width: 26 }} />
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <Text style={styles.label}>Give it a name</Text>
            <View style={styles.input}>
              <TextInput value={title} onChangeText={setTitle} placeholder="Ex: Sunset Rooftop"
                placeholderTextColor={theme.color.onSurface3} style={styles.text}
                testID="new-project-title" />
            </View>

            <Text style={styles.label}>Type of shoot</Text>
            <View style={styles.chipRow}>
              {types.map((id) => chip(shootType === id, label(id), () => setShootType(id), `chip-shoot-${id}`))}
              <Pressable onPress={() => setCustomOpen(true)} style={[styles.chip, styles.chipAdd]} testID="chip-shoot-add-custom">
                <Ionicons name="add" size={16} color={theme.color.brand} />
                <Text style={[styles.chipText, { color: theme.color.brand, marginLeft: 4 }]}>Custom</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>Mood</Text>
            <View style={styles.chipRow}>
              {MOODS.map((m) => chip(mood === m, m, () => setMood(m), `chip-mood-${m}`))}
            </View>

            <Text style={styles.label}>Duration</Text>
            <View style={styles.chipRow}>
              {DURATIONS.map((d) => chip(duration === d, `${d}s`, () => setDuration(d), `chip-dur-${d}`))}
            </View>

            <Text style={styles.label}>Platform</Text>
            <View style={styles.chipRow}>
              {PLATFORMS.map((p) => chip(platform === p.id, p.label, () => setPlatform(p.id), `chip-plat-${p.id}`))}
            </View>

            <Text style={styles.label}>What is it for? (optional)</Text>
            <View style={styles.input}>
              <TextInput value={purpose} onChangeText={setPurpose} placeholder="Ex: launch of my new bakery"
                placeholderTextColor={theme.color.onSurface3} style={styles.text}
                testID="new-project-purpose" />
            </View>

            <Text style={styles.label}>Target audience (optional)</Text>
            <View style={styles.input}>
              <TextInput value={audience} onChangeText={setAudience} placeholder="Ex: 25-40, foodies"
                placeholderTextColor={theme.color.onSurface3} style={styles.text}
                testID="new-project-audience" />
            </View>

            <Pressable
              style={[styles.primary, (!canSubmit || busy) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={!canSubmit || busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit || busy }}
              testID="new-project-create-button"
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Text style={styles.primaryText}>Create project</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </Pressable>
            {createError ? (
              <View style={styles.errorWrap}>
                <Text accessibilityRole="alert" testID="new-project-error" style={styles.error}>{createError}</Text>
                {/sign in|session/i.test(createError) ? (
                  <Pressable onPress={() => router.replace('/(auth)/login')} testID="new-project-sign-in-again">
                    <Text style={styles.errorAction}>Sign in again</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={customOpen} transparent animationType="fade" onRequestClose={() => setCustomOpen(false)}>
        <View style={styles.modalRoot}>
          <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Custom shoot type</Text>
            <Text style={styles.modalSub}>AI will adapt the storyboard to your idea.</Text>
            <View style={[styles.input, { marginTop: 16 }]}>
              <TextInput
                value={customName}
                onChangeText={setCustomName}
                placeholder="Ex: Birthday Party, Bike Ride, College Fest"
                placeholderTextColor={theme.color.onSurface3}
                autoFocus
                style={styles.text}
                testID="custom-shoot-input"
                onSubmitEditing={addCustom}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable style={styles.modalGhost} onPress={() => { setCustomOpen(false); setCustomName(''); }} testID="custom-shoot-cancel">
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalPrimary} onPress={addCustom} testID="custom-shoot-save">
                <Text style={styles.modalPrimaryText}>Add</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { flex: 1, textAlign: 'center', color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  label: { color: theme.color.onSurface2, fontSize: 13, marginTop: 20, marginBottom: 10, letterSpacing: 0.3, textTransform: 'uppercase' },
  input: { backgroundColor: theme.color.surface3, borderRadius: theme.radius.md, paddingHorizontal: 16, height: 56, justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border },
  text: { color: theme.color.onSurface, fontSize: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, height: 36, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
  },
  chipOn: { backgroundColor: theme.color.brandTint, borderColor: theme.color.brand },
  chipAdd: { borderColor: theme.color.brand, borderStyle: 'dashed' },
  chipText: { color: theme.color.onSurface2, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: theme.color.brand },
  primary: {
    marginTop: 32, height: 56, borderRadius: theme.radius.md,
    backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 10,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  errorWrap: { marginTop: 12, alignItems: 'center', gap: 8 },
  error: { color: theme.color.error, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorAction: { color: theme.color.brand, fontSize: 14, fontWeight: '700' },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: theme.color.surface2, borderRadius: theme.radius.lg, padding: 22, borderWidth: 1, borderColor: theme.color.border },
  modalTitle: { color: theme.color.onSurface, fontSize: 20, fontWeight: '700' },
  modalSub: { color: theme.color.onSurface2, fontSize: 13, marginTop: 6 },
  modalGhost: { flex: 1, height: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  modalGhostText: { color: theme.color.onSurface, fontWeight: '700' },
  modalPrimary: { flex: 1, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  modalPrimaryText: { color: '#fff', fontWeight: '700' },
});
