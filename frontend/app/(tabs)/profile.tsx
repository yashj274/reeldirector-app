import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearAuth, getUser } from '@/src/api';
import { theme } from '@/src/theme';

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => { getUser().then(setUser); }, []);

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
          <Text style={styles.title}>Profile</Text>

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

          <Text style={styles.section}>Preferences</Text>
          <View style={styles.list}>
            {row('language-outline', 'Language', 'profile-language', () => router.push('/settings/language'))}
            {row('color-palette-outline', 'Editing style', 'profile-editing-style')}
          </View>

          <Text style={styles.section}>Account</Text>
          <View style={styles.list}>
            {row('card-outline', 'Subscription', 'profile-subscription')}
            {row('cloud-download-outline', 'Downloads', 'profile-downloads')}
            {row('notifications-outline', 'Notifications', 'profile-notifications')}
          </View>

          <Text style={styles.section}>Support</Text>
          <View style={styles.list}>
            {row('help-circle-outline', 'Help & FAQ', 'profile-help')}
            {row('chatbubble-outline', 'Send Feedback', 'profile-feedback')}
            {row('shield-checkmark-outline', 'Privacy', 'profile-privacy')}
          </View>

          <Pressable style={styles.logout} onPress={logout} testID="profile-logout-button">
            <Text style={styles.logoutText}>Log out</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: theme.color.divider },
  rowText: { flex: 1, color: theme.color.onSurface, fontSize: 15 },
  logout: { marginTop: 20, height: 52, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border },
  logoutText: { color: theme.color.error, fontWeight: '700' },
});
