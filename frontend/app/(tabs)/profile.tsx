import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  clearAuth, getUser, getCreatorSkillLevel, setCreatorSkillLevel, CreatorSkillLevel,
  getCreatorStyleProfile, saveCreatorStylePreferences, resetCreatorStyleProfile,
  CreatorStyleProfile, CreatorStyle, CreatorStyleMood,
} from '@/src/api';
import { theme } from '@/src/theme';
import { useT } from '@/src/i18n';

export default function Profile() {
  const t = useT();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [user, setUser] = useState<any>(null);
  const [skill, setSkill] = useState<CreatorSkillLevel>('beginner');
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillError, setSkillError] = useState('');
  const [styleProfile, setStyleProfile] = useState<CreatorStyleProfile | null>(null);
  const [styleSaving, setStyleSaving] = useState(false);
  const [styleError, setStyleError] = useState('');
  const [styleY, setStyleY] = useState(0);

  useEffect(() => {
    void Promise.all([getUser(), getCreatorSkillLevel(), getCreatorStyleProfile()]).then(([profile, level, style]) => {
      setUser(profile);
      setSkill(level);
      setStyleProfile(style);
    });
  }, []);

  const saveSkill = async (level: CreatorSkillLevel) => {
    setSkillSaving(true);
    setSkillError('');
    try { await setCreatorSkillLevel(level); setSkill(level); }
    catch (error: any) { setSkillError(error?.message || 'Could not save this preference. Try again.'); }
    finally { setSkillSaving(false); }
  };

  const saveStyle = async (preferences: Partial<Pick<CreatorStyleProfile, 'style' | 'mood' | 'duration_seconds'>>) => {
    if (!styleProfile) return;
    setStyleSaving(true);
    setStyleError('');
    setStyleProfile({ ...styleProfile, ...preferences });
    try { setStyleProfile(await saveCreatorStylePreferences(preferences)); }
    catch (error: any) { setStyleError(error?.message || 'Could not save this preference. Try again.'); }
    finally { setStyleSaving(false); }
  };

  const resetStyle = () => Alert.alert(t('reset_style_profile'), t('reset_style_confirm'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('reset'), style: 'destructive', onPress: () => {
      void resetCreatorStyleProfile().then(() => getCreatorStyleProfile()).then(setStyleProfile)
        .catch((error: any) => setStyleError(error?.message || 'Could not reset this profile. Try again.'));
    } },
  ]);

  const logout = async () => {
    await clearAuth();
    router.replace('/(auth)/login');
  };

  const row = (icon: keyof typeof Ionicons.glyphMap, label: string, testID: string, onPress?: () => void) => (
    <Pressable style={styles.row} onPress={onPress} testID={testID}>
      <Ionicons name={icon} size={20} color={theme.color.onSurface} />
      <Text style={styles.rowText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={theme.color.onSurface3} />
    </Pressable>
  );

  return (
    <View style={styles.root} testID="profile-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
          <Text style={styles.title}>{t('profile')}</Text>

          <View style={styles.card}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(user?.name?.[0] || 'D').toUpperCase()}</Text>
            </View>
            <Text style={styles.name}>{user?.name || 'Director'}</Text>
            <Text style={styles.email}>{user?.email || ''}</Text>
            <View style={styles.planPill}>
              <Text style={styles.planText}>{(user?.plan || 'free').toUpperCase()} PLAN</Text>
            </View>
          </View>

          <Text style={styles.section}>{t('preferences')}</Text>
          <View style={styles.list}>
            {row('language-outline', t('language'), 'profile-language', () => router.push('/settings/language'))}
            {row('color-palette-outline', t('editing_style'), 'profile-editing-style', () => scrollRef.current?.scrollTo({ y: styleY, animated: true }))}
          </View>
          <View style={styles.skillPicker}>
            <Text style={styles.skillTitle}>{t('creator_skill_level')}</Text>
            <Text style={styles.skillHelp}>{t('skill_help')}</Text>
            <View style={styles.skillOptions}>
              {(['beginner', 'creator', 'pro'] as CreatorSkillLevel[]).map((level) => (
                <Pressable key={level} onPress={() => void saveSkill(level)} disabled={skillSaving}
                  style={[styles.skillOption, skill === level && styles.skillOptionOn]}
                  accessibilityRole="button" accessibilityState={{ selected: skill === level, disabled: skillSaving }}
                  testID={`profile-skill-${level}`}>
                  <Text style={[styles.skillOptionText, skill === level && styles.skillOptionTextOn]}>{t(level)}</Text>
                </Pressable>
              ))}
            </View>
            {!!skillError && <Text style={styles.skillError} accessibilityRole="alert">{skillError}</Text>}
          </View>

          <View onLayout={(event) => setStyleY(Math.max(0, event.nativeEvent.layout.y - 16))} style={styles.styleCard} testID="creator-style-profile">
            <Text style={styles.skillTitle}>{t('my_creator_style')}</Text>
            <Text style={styles.skillHelp}>{t('creator_style_help')}</Text>
            {styleProfile && <>
              <Text style={styles.styleLabel}>{t('style_label')}</Text>
              <View style={styles.preferenceOptions}>
                {(['cinematic', 'fast_pace', 'minimal', 'editorial', 'luxury', 'action'] as CreatorStyle[]).map((style) => (
                  <Pressable key={style} onPress={() => void saveStyle({ style })} disabled={styleSaving}
                    style={[styles.preferenceOption, styleProfile.style === style && styles.skillOptionOn]}
                    accessibilityRole="button" accessibilityState={{ selected: styleProfile.style === style, disabled: styleSaving }}
                    testID={`profile-style-${style}`}>
                    <Text style={[styles.skillOptionText, styleProfile.style === style && styles.skillOptionTextOn]}>{t(`style_${style}`)}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.styleLabel}>{t('mood')}</Text>
              <View style={styles.preferenceOptions}>
                {(['Cinematic', 'Emotional', 'Energetic', 'Luxury', 'Minimal', 'Warm'] as CreatorStyleMood[]).map((mood) => (
                  <Pressable key={mood} onPress={() => void saveStyle({ mood })} disabled={styleSaving}
                    style={[styles.preferenceOption, styleProfile.mood === mood && styles.skillOptionOn]}
                    accessibilityRole="button" accessibilityState={{ selected: styleProfile.mood === mood, disabled: styleSaving }}
                    testID={`profile-mood-${mood.toLowerCase()}`}>
                    <Text style={[styles.skillOptionText, styleProfile.mood === mood && styles.skillOptionTextOn]}>{t(`mood_${mood.toLowerCase()}`)}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.styleLabel}>{t('preferred_duration')}</Text>
              <View style={styles.preferenceOptions}>
                {[15, 20, 30, 45, 60].map((duration) => (
                  <Pressable key={duration} onPress={() => void saveStyle({ duration_seconds: duration })} disabled={styleSaving}
                    style={[styles.durationOption, styleProfile.duration_seconds === duration && styles.skillOptionOn]}
                    accessibilityRole="button" accessibilityState={{ selected: styleProfile.duration_seconds === duration, disabled: styleSaving }}
                    testID={`profile-duration-${duration}`}>
                    <Text style={[styles.skillOptionText, styleProfile.duration_seconds === duration && styles.skillOptionTextOn]}>{duration}s</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.profileSummary} testID="creator-style-summary">
                {styleProfile.project_count
                  ? t('creator_style_learned').replace('{count}', String(styleProfile.project_count))
                    .replace('{category}', t(`shoot_type_${styleProfile.category}`) || styleProfile.category)
                    .replace('{goal}', t(`goal_${styleProfile.goal}`))
                    .replace('{pacing}', t(`pacing_${styleProfile.pacing}`))
                    .replace('{text}', t(`text_amount_${styleProfile.text_amount}`))
                    .replace('{movements}', styleProfile.movements.map((movement) => t(`move_${movement}`)).join(', ') || t('not_enough_data'))
                  : t('creator_style_empty')}
              </Text>
            </>}
            {!!styleError && <Text style={styles.skillError} accessibilityRole="alert">{styleError}</Text>}
            <Pressable onPress={resetStyle} style={styles.resetButton} testID="profile-reset-style">
              <Text style={styles.resetText}>{t('reset_style_profile')}</Text>
            </Pressable>
          </View>

          <Text style={styles.section}>{t('account')}</Text>
          <View style={styles.list}>
            {row('card-outline', t('subscription'), 'profile-subscription')}
            {row('cloud-download-outline', t('downloads'), 'profile-downloads')}
            {row('notifications-outline', t('notifications'), 'profile-notifications')}
          </View>

          <Text style={styles.section}>{t('support')}</Text>
          <View style={styles.list}>
            {row('help-circle-outline', t('help_faq'), 'profile-help')}
            {row('chatbubble-outline', t('send_feedback'), 'profile-feedback')}
            {row('shield-checkmark-outline', t('privacy'), 'profile-privacy')}
          </View>

          <Pressable style={styles.logout} onPress={logout} testID="profile-logout-button">
            <Text style={styles.logoutText}>{t('log_out')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  title: { color: theme.color.onSurface, fontSize: 28, fontWeight: '700', letterSpacing: -0.8, marginBottom: 20 },
  card: {
    alignItems: 'center', padding: 24, borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, marginBottom: 24,
  },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  name: { color: theme.color.onSurface, fontSize: 20, fontWeight: '700' },
  email: { color: theme.color.onSurface2, marginTop: 4 },
  planPill: { marginTop: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandTint },
  planText: { color: theme.color.brand, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  section: { color: theme.color.onSurface3, fontSize: 12, marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 1 },
  list: { borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, marginBottom: 24, overflow: 'hidden' },
  skillPicker: { marginTop: -12, marginBottom: 24, padding: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  styleCard: { marginTop: -12, marginBottom: 24, padding: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  skillTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: '700' },
  skillHelp: { color: theme.color.onSurface3, fontSize: 12, marginTop: 4 },
  skillOptions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  preferenceOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  skillOption: { flex: 1, minHeight: 40, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  preferenceOption: { minWidth: 88, minHeight: 38, paddingHorizontal: 12, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  durationOption: { minWidth: 48, minHeight: 38, paddingHorizontal: 10, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  styleLabel: { color: theme.color.onSurface2, fontSize: 12, fontWeight: '700', marginTop: 18 },
  profileSummary: { color: theme.color.onSurface2, fontSize: 12, lineHeight: 18, marginTop: 16, padding: 12, borderRadius: theme.radius.sm, backgroundColor: theme.color.surface3 },
  resetButton: { alignSelf: 'flex-start', marginTop: 14, paddingVertical: 6 },
  resetText: { color: theme.color.brand, fontWeight: '700', fontSize: 13 },
  skillOptionOn: { borderColor: theme.color.brand, backgroundColor: theme.color.brandTint },
  skillOptionText: { color: theme.color.onSurface2, fontSize: 13, fontWeight: '600' },
  skillOptionTextOn: { color: theme.color.brand },
  skillError: { color: theme.color.error, marginTop: 8, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: theme.color.divider },
  rowText: { flex: 1, color: theme.color.onSurface, fontSize: 15 },
  logout: { marginTop: 20, height: 52, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border },
  logoutText: { color: theme.color.error, fontWeight: '700' },
});
