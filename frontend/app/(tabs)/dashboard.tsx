import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { api, getUser } from '@/src/api';
import { theme } from '@/src/theme';
import { useT } from '@/src/i18n';

export default function Dashboard() {
  const t = useT();
  const router = useRouter();
  const [templates, setTemplates] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const [t, p, u] = await Promise.all([api.templates(), api.listProjects(5), getUser()]);
      setTemplates(t); setProjects(p); setUser(u);
      setLoadError('');
    } catch (e: any) {
      console.warn('Dashboard load failed:', e);
      setLoadError(e?.message || 'Could not load your projects. Check your connection and try again.');
    }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void api.warmBackend(); void load(); }, [load]);

  const onNewProject = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push('/project/new');
  };

  const onTemplate = (tpl: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push({ pathname: '/project/new', params: { template: tpl.id, mood: tpl.mood, style: tpl.style, duration: String(tpl.duration) } });
  };

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.color.brand} />
      </View>
    );
  }

  return (
    <View style={styles.root} testID="dashboard-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 140 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} tintColor={theme.color.brand}
              onRefresh={() => { setRefreshing(true); load(); }} />
          }
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hello}>{t('dashboard_hello').replace('{name}', user?.name?.split(' ')[0] || 'Director')}</Text>
              <Text style={styles.title}>{t('ready_magic')}</Text>
            </View>
            <Pressable style={styles.avatar} onPress={() => router.push('/(tabs)/profile')} testID="dashboard-avatar">
              <Text style={styles.avatarText}>{(user?.name?.[0] || 'D').toUpperCase()}</Text>
            </Pressable>
          </View>

          {loadError ? (
            <View style={styles.loadError} testID="dashboard-load-error">
              <Text style={styles.loadErrorText}>{loadError}</Text>
              <Pressable onPress={() => { setRefreshing(true); load(); }} testID="dashboard-retry-button">
                <Text style={styles.loadErrorAction}>{t('try_again')}</Text>
              </Pressable>
              {/sign in|session/i.test(loadError) ? (
                <Pressable onPress={() => router.replace('/(auth)/login')} testID="dashboard-sign-in-again">
                  <Text style={styles.loadErrorAction}>{t('sign_in_again')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Pressable style={styles.cta} onPress={onNewProject} testID="dashboard-new-project-button">
            <LinearGradient colors={[theme.color.brand, theme.color.brandDim]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill} />
            <View style={styles.ctaInner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ctaTitle}>{t('start_new_reel')}</Text>
                <Text style={styles.ctaSub}>{t('ai_plans_directs_edits')}</Text>
              </View>
              <View style={styles.ctaIcon}>
                <Ionicons name="arrow-forward" size={22} color="#fff" />
              </View>
            </View>
          </Pressable>

          <Text style={styles.sectionTitle}>{t('cinematic_templates')}</Text>
          <FlatList
            data={templates}
            horizontal
            keyExtractor={(t) => t.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            renderItem={({ item }) => (
              <Pressable style={styles.tpl} onPress={() => onTemplate(item)} testID={`template-card-${item.id}`}>
                <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <LinearGradient colors={['transparent', 'rgba(10,11,14,0.9)']} style={StyleSheet.absoluteFill} />
                <View style={styles.tplText}>
                  <Text style={styles.tplName}>{t(`template_${item.id}`)}</Text>
                  <Text style={styles.tplMood}>{t(`template_mood_${item.id}`)} · {item.duration}s</Text>
                </View>
              </Pressable>
            )}
          />

          <View style={styles.recentHead}>
            <Text style={styles.sectionTitle}>{t('recent_projects')}</Text>
            <Pressable onPress={() => router.push('/(tabs)/projects')}>
              <Text style={{ color: theme.color.brand, fontWeight: '600' }}>{t('see_all')}</Text>
            </Pressable>
          </View>

          {projects.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="film-outline" size={40} color={theme.color.onSurface3} />
              <Text style={styles.emptyText}>{t('first_masterpiece')}</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              {projects.slice(0, 5).map((p) => (
                <Pressable key={p.id} style={styles.projRow}
                  onPress={() => router.push(`/project/${p.id}`)}
                  testID={`project-row-${p.id}`}>
                  <View style={styles.projThumb}>
                    {p.thumbnail_url ? (
                      <Image source={{ uri: p.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <Ionicons name="film" size={22} color={theme.color.onSurface3} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.projTitle} numberOfLines={1}>{p.title}</Text>
                    <Text style={styles.projMeta}>{p.shoot_type} · {t(`project_status_${p.status}`)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.color.onSurface3} />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  hello: { color: theme.color.onSurface2, fontSize: 14 },
  title: { color: theme.color.onSurface, fontSize: 28, fontWeight: '700', marginTop: 4, letterSpacing: -0.8 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surface3,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border,
  },
  avatarText: { color: theme.color.onSurface, fontWeight: '700' },
  cta: {
    marginHorizontal: 20, height: 108, borderRadius: theme.radius.lg,
    overflow: 'hidden', marginBottom: 28,
  },
  ctaInner: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 20 },
  ctaTitle: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  ctaSub: { color: 'rgba(255,255,255,0.85)', marginTop: 4, fontSize: 13 },
  ctaIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: '700', paddingHorizontal: 20, marginBottom: 12, letterSpacing: -0.3 },
  tpl: {
    width: 180, height: 220, borderRadius: theme.radius.lg, overflow: 'hidden',
    backgroundColor: theme.color.surface2,
  },
  tplText: { position: 'absolute', bottom: 14, left: 14, right: 14 },
  tplName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  tplMood: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
  recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 32, marginBottom: 12 },
  empty: { padding: 40, alignItems: 'center', gap: 12 },
  emptyText: { color: theme.color.onSurface2 },
  loadError: { marginHorizontal: 20, marginTop: 18, padding: 14, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.28)', gap: 8 },
  loadErrorText: { color: theme.color.error, fontSize: 14, lineHeight: 20 },
  loadErrorAction: { color: theme.color.brand, fontSize: 14, fontWeight: '700' },
  projRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: 12, borderWidth: 1, borderColor: theme.color.border,
  },
  projThumb: {
    width: 56, height: 56, borderRadius: 8, backgroundColor: theme.color.surface3,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  projTitle: { color: theme.color.onSurface, fontWeight: '600', fontSize: 15 },
  projMeta: { color: theme.color.onSurface3, fontSize: 12, marginTop: 3, textTransform: 'capitalize' },
});
