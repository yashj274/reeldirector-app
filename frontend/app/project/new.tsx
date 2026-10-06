import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { api, CreatorStyleProfile, getCreatorStyleProfile } from '@/src/api';
import { getLanguage, useT } from '@/src/i18n';
import { theme } from '@/src/theme';

const DEFAULT_TYPES = [
  'wedding', 'travel', 'food', 'fashion', 'gym', 'product', 'real_estate',
  'cafe', 'restaurant', 'event', 'documentary', 'business', 'lifestyle',
  'daily_vlog', 'social_media', 'cinematic',
];
const label = (id: string, t: (key: string) => string) => {
  const key = `shoot_type_${id}`;
  const translated = t(key);
  return translated === key ? id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : translated;
};

const MOODS = ['Cinematic', 'Emotional', 'Energetic', 'Luxury', 'Minimal', 'Warm'];
const STYLES = ['cinematic', 'fast_pace', 'minimal', 'editorial', 'luxury', 'action'];
const DURATIONS = [15, 20, 30, 45, 60];
const PLATFORMS = [
  { id: 'instagram_reel', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube_shorts', label: 'YouTube' },
];

function inferDefaults(value: string) {
  const text = value.toLowerCase();
  if (/wedding|mehndi|haldi|engagement|anniversary|ceremony|bride|groom/.test(text)) return { category: 'wedding', mood: 'Emotional', duration: 45, style: 'cinematic', specific: true };
  if (/travel|trip|holiday|vacation|journey|mountain|beach/.test(text)) return { category: 'travel', mood: 'Cinematic', duration: 30, style: 'cinematic', specific: true };
  if (/food|recipe|cafe|coffee|restaurant|dish|cook/.test(text)) return { category: 'food', mood: 'Warm', duration: 20, style: 'minimal', specific: true };
  if (/fashion|outfit|clothes|lookbook|makeup|beauty/.test(text)) return { category: 'fashion', mood: 'Minimal', duration: 20, style: 'editorial', specific: true };
  if (/gym|fitness|workout|training|exercise/.test(text)) return { category: 'gym', mood: 'Energetic', duration: 20, style: 'action', specific: true };
  if (/house|home|property|apartment|room|hotel|interior/.test(text)) return { category: 'real_estate', mood: 'Luxury', duration: 45, style: 'luxury', specific: true };
  if (/product|shop|launch|brand|business|sell|sale/.test(text)) return { category: 'product', mood: 'Minimal', duration: 15, style: 'minimal', specific: true };
  if (/birthday|party|concert|festival|event|graduation/.test(text)) return { category: 'event', mood: 'Energetic', duration: 30, style: 'cinematic', specific: true };
  return { category: 'social_media', mood: 'Cinematic', duration: 30, style: 'cinematic', specific: false };
}

export default function NewProject() {
  const router = useRouter();
  const t = useT();
  const params = useLocalSearchParams<{ template?: string; mood?: string; style?: string; duration?: string }>();

  const [title, setTitle] = useState('');
  const [types, setTypes] = useState<string[]>(DEFAULT_TYPES);
  const [shootType, setShootType] = useState<string>(params.template || 'social_media');
  const [mood, setMood] = useState<string>(params.mood?.split(' ')[0] || 'Cinematic');
  const [duration, setDuration] = useState<number>(params.duration ? parseInt(params.duration) : 30);
  const [style, setStyle] = useState<string>((params.style as string) || 'cinematic');
  const [platform, setPlatform] = useState<string>('instagram_reel');
  const [audience, setAudience] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [creatorProfile, setCreatorProfile] = useState<CreatorStyleProfile | null>(null);
  const [useMyStyle, setUseMyStyle] = useState(false);
  const [moreOptions, setMoreOptions] = useState(false);
  const [choicesTouched, setChoicesTouched] = useState(false);

  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');

  const canSubmit = useMemo(() => title.trim().length >= 2 && purpose.trim().length >= 10, [title, purpose]);

  useEffect(() => {
    void getCreatorStyleProfile().then((profile) => {
      setCreatorProfile(profile);
      if (!params.template && (profile.project_count > 0 || profile.has_preferences)) {
        setUseMyStyle(true);
        setMood(profile.mood);
        setDuration(profile.duration_seconds);
        setStyle(profile.style);
      }
    }).catch(() => {});
  }, [params.template]);

  useEffect(() => {
    if (params.template || choicesTouched) return;
    const defaults = inferDefaults(`${title} ${purpose}`);
    setShootType(useMyStyle && !defaults.specific && creatorProfile?.project_count
      ? (DEFAULT_TYPES.includes(creatorProfile.category) ? creatorProfile.category : defaults.category)
      : defaults.category);
    if (!useMyStyle) {
      setMood(defaults.mood);
      setDuration(defaults.duration);
      setStyle(defaults.style);
    }
  }, [title, purpose, params.template, choicesTouched, useMyStyle, creatorProfile]);

  const addCustom = () => {
    const raw = customName.trim();
    if (raw.length < 2) return;
    const id = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!types.includes(id)) setTypes([id, ...types]);
    setShootType(id);
    setChoicesTouched(true);
    setCustomName('');
    setCustomOpen(false);
  };

  const toggleMyStyle = () => {
    const next = !useMyStyle;
    setUseMyStyle(next);
    setChoicesTouched(false);
    if (next && creatorProfile) {
      const inferred = inferDefaults(`${title} ${purpose}`);
      setShootType(inferred.specific ? inferred.category : DEFAULT_TYPES.includes(creatorProfile.category) ? creatorProfile.category : 'social_media');
      setMood(creatorProfile.mood);
      setDuration(creatorProfile.duration_seconds);
      setStyle(creatorProfile.style);
    }
  };

  const submit = async () => {
    if (title.trim().length < 2) { setCreateError(t('title_required_error')); return; }
    if (purpose.trim().length < 10) { setCreateError(t('purpose_required')); return; }
    if (!canSubmit) return;
    setCreateError('');
    setBusy(true);
    try {
      const p = await api.createProject({
        title: title.trim(), shoot_type: shootType, purpose, mood, duration_seconds: duration,
        style, platform, audience, language: await getLanguage(), use_creator_style: useMyStyle,
      });
      router.replace({ pathname: '/project/[id]/scan', params: { id: p.id, flow: 'new' } });
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
          <Text style={styles.title}>{t('new_reel')}</Text>
          <View style={{ width: 26 }} />
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <Text style={styles.label}>{t('give_reel_name')}</Text>
            <View style={styles.input}>
              <TextInput value={title} onChangeText={setTitle} placeholder={t('reel_name_example')}
                placeholderTextColor={theme.color.onSurface3} style={styles.text}
                testID="new-project-title" />
            </View>

            <Text style={styles.label}>{t('purpose_label')} <Text style={{ color: theme.color.brand }}>*</Text></Text>
            <View style={[styles.input, styles.purposeInput]}>
              <TextInput value={purpose} onChangeText={(value) => { setPurpose(value); setCreateError(''); }}
                placeholder={t('purpose_placeholder')}
                placeholderTextColor={theme.color.onSurface3} style={[styles.text, styles.purposeText]}
                multiline textAlignVertical="top" maxLength={500}
                testID="new-project-purpose" />
            </View>
            <Text style={styles.helper}>{t('purpose_hint')}</Text>

            <Pressable style={[styles.myStyle, useMyStyle && styles.myStyleOn]} onPress={toggleMyStyle}
              accessibilityRole="checkbox" accessibilityState={{ checked: useMyStyle }} testID="new-project-use-my-style">
              <Ionicons name={useMyStyle ? 'checkbox' : 'square-outline'} size={22} color={useMyStyle ? theme.color.brand : theme.color.onSurface3} />
              <View style={{ flex: 1 }}>
                <Text style={styles.myStyleTitle}>{t('create_in_my_style')}</Text>
                <Text style={styles.myStyleHint}>{t('create_in_my_style_help')}</Text>
              </View>
            </Pressable>

            <Pressable style={styles.moreOptions} onPress={() => setMoreOptions((value) => !value)} testID="new-project-more-options">
              <Text style={styles.moreOptionsText}>{moreOptions ? t('fewer_options') : t('more_options')}</Text>
              <Ionicons name={moreOptions ? 'chevron-up' : 'chevron-down'} size={18} color={theme.color.onSurface2} />
            </Pressable>
            {moreOptions && <View style={styles.advanced}>
              <Text style={styles.label}>{t('type_of_shoot')}</Text>
              <View style={styles.chipRow}>
                {types.map((id) => chip(shootType === id, label(id, t), () => { setChoicesTouched(true); setShootType(id); }, `chip-shoot-${id}`))}
                <Pressable onPress={() => setCustomOpen(true)} style={[styles.chip, styles.chipAdd]} testID="chip-shoot-add-custom">
                  <Ionicons name="add" size={16} color={theme.color.brand} />
                  <Text style={[styles.chipText, { color: theme.color.brand, marginLeft: 4 }]}>{t('custom')}</Text>
                </Pressable>
              </View>
              <Text style={styles.label}>{t('style_label')}</Text>
              <View style={styles.chipRow}>
                {STYLES.map((value) => chip(style === value, t(`style_${value}`), () => { setChoicesTouched(true); setStyle(value); }, `chip-style-${value}`))}
              </View>
              <Text style={styles.label}>{t('mood')}</Text>
              <View style={styles.chipRow}>
                {MOODS.map((m) => chip(mood === m, t(`mood_${m.toLowerCase()}`), () => { setChoicesTouched(true); setMood(m); }, `chip-mood-${m}`))}
              </View>
              <Text style={styles.label}>{t('duration')}</Text>
              <View style={styles.chipRow}>
                {DURATIONS.map((d) => chip(duration === d, `${d}s`, () => { setChoicesTouched(true); setDuration(d); }, `chip-dur-${d}`))}
              </View>
              <Text style={styles.label}>{t('platform')}</Text>
              <View style={styles.chipRow}>
                {PLATFORMS.map((p) => chip(platform === p.id, p.label, () => { setChoicesTouched(true); setPlatform(p.id); }, `chip-plat-${p.id}`))}
              </View>
              <Text style={styles.label}>{t('target_audience')}</Text>
              <View style={styles.input}>
                <TextInput value={audience} onChangeText={setAudience} placeholder={t('audience_example')}
                  placeholderTextColor={theme.color.onSurface3} style={styles.text} testID="new-project-audience" />
              </View>
            </View>}

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
                <Text style={styles.primaryText}>{t('create_project')}</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </Pressable>
            {createError ? (
              <View style={styles.errorWrap}>
                <Text accessibilityRole="alert" testID="new-project-error" style={styles.error}>{createError}</Text>
                {/sign in|session/i.test(createError) ? (
                  <Pressable onPress={() => router.replace('/(auth)/login')} testID="new-project-sign-in-again">
                    <Text style={styles.errorAction}>{t('sign_in_again')}</Text>
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
            <Text style={styles.modalTitle}>{t('custom_shoot_type')}</Text>
            <Text style={styles.modalSub}>{t('custom_shoot_help')}</Text>
            <View style={[styles.input, { marginTop: 16 }]}>
              <TextInput
                value={customName}
                onChangeText={setCustomName}
                placeholder={t('custom_shoot_example')}
                placeholderTextColor={theme.color.onSurface3}
                autoFocus
                style={styles.text}
                testID="custom-shoot-input"
                onSubmitEditing={addCustom}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable style={styles.modalGhost} onPress={() => { setCustomOpen(false); setCustomName(''); }} testID="custom-shoot-cancel">
                <Text style={styles.modalGhostText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable style={styles.modalPrimary} onPress={addCustom} testID="custom-shoot-save">
                <Text style={styles.modalPrimaryText}>{t('add')}</Text>
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
  purposeInput: { height: 136, justifyContent: 'flex-start' },
  purposeText: { minHeight: 112, paddingVertical: 12 },
  helper: { color: theme.color.onSurface3, fontSize: 12, lineHeight: 17, marginTop: 7 },
  text: { color: theme.color.onSurface, fontSize: 16 },
  myStyle: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 18, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  myStyleOn: { borderColor: theme.color.brand, backgroundColor: theme.color.brandTint },
  myStyleTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: '700' },
  myStyleHint: { color: theme.color.onSurface3, fontSize: 12, lineHeight: 17, marginTop: 3 },
  moreOptions: { minHeight: 48, marginTop: 10, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moreOptionsText: { color: theme.color.onSurface2, fontWeight: '700', fontSize: 14 },
  advanced: { paddingBottom: 8 },
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
