import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearAuth, getUser, getCreatorSkillLevel, setCreatorSkillLevel, CreatorSkillLevel } from '@/src/api';
import { theme } from '@/src/theme';
import { useT } from '@/src/i18n';

export default function Profile() {
  const t = useT();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [skill, setSkill] = useState<CreatorSkillLevel>('beginner');
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillError, setSkillError] = useState('');

  useEffect(() => {
    void Promise.all([getUser(), getCreatorSkillLevel()]).then(([profile, level]) => {
      setUser(profile);
      setSkill(level);
    });
  }, []);

  const saveSkill = async (level: CreatorSkillLevel) => {
    setSkillSaving(true);
    setSkillError('');
    try { await setCreatorSkillLevel(level); setSkill(level); }
    catch (error: any) { setSkillError(error?.message || 'Could not save this preference. Try again.'); }
    finally { setSkillSaving(false); }
  };

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
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
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
            {row('color-palette-outline', t('editing_style'), 'profile-editing-style')}
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
  skillTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: '700' },
  skillHelp: { color: theme.color.onSurface3, fontSize: 12, marginTop: 4 },
  skillOptions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  skillOption: { flex: 1, minHeight: 40, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  skillOptionOn: { borderColor: theme.color.brand, backgroundColor: theme.color.brandTint },
  skillOptionText: { color: theme.color.onSurface2, fontSize: 13, fontWeight: '600' },
  skillOptionTextOn: { color: theme.color.brand },
  skillError: { color: theme.color.error, marginTop: 8, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: theme.color.divider },
  rowText: { flex: 1, color: theme.color.onSurface, fontSize: 15 },
  logout: { marginTop: 20, height: 52, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border },
  logoutText: { color: theme.color.error, fontWeight: '700' },
});
