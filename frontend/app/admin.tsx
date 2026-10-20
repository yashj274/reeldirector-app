import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api } from '@/src/api';
import { theme } from '@/src/theme';

type AdminTab = 'overview' | 'users' | 'projects';
type PageResult = { items: any[]; page: number; per_page: number; has_more?: boolean; total?: number };

const SERVICE_LABELS: Record<string, string> = {
  database: 'Supabase database',
  gemini: 'Gemini AI',
  local_rendering: 'Built-in video renderer',
  creatomate: 'Creatomate rendering',
  ai_video: 'AI video generation',
};

export default function AdminScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState<PageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    const access = await api.adminAccess();
    if (!access?.is_admin) {
      setAllowed(false);
      setChecking(false);
      return;
    }
    setAllowed(true);
    setOverview(await api.adminOverview());
  }, []);

  const loadPage = useCallback(async (selectedTab: AdminTab, selectedPage: number) => {
    if (selectedTab === 'overview') return;
    setLoading(true);
    setError('');
    try {
      const result = selectedTab === 'users'
        ? await api.adminUsers(selectedPage)
        : await api.adminProjects(selectedPage);
      setPageData(result);
    } catch (cause: any) {
      setError(cause?.message || 'Could not load this list. Try again.');
      setPageData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadOverview().catch((cause: any) => {
      if (active) setError(cause?.message || 'Could not verify admin access. Check the service and try again.');
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, [loadOverview]);

  useEffect(() => {
    if (allowed && tab !== 'overview') void loadPage(tab, page);
  }, [allowed, tab, page, loadPage]);

  const selectTab = (next: AdminTab) => {
    setTab(next);
    setPage(1);
    setPageData(null);
    setError('');
  };

  const retry = () => {
    setError('');
    if (tab === 'overview') {
      setChecking(true);
      void loadOverview().catch((cause: any) => setError(cause?.message || 'Could not load admin overview.'))
        .finally(() => setChecking(false));
    } else {
      void loadPage(tab, page);
    }
  };

  return (
    <View style={styles.root} testID="admin-screen">
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={21} color={theme.color.onSurface} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>REELDIRECTOR</Text>
            <Text style={styles.title}>Admin console</Text>
          </View>
          <Pressable onPress={retry} style={styles.refresh} accessibilityRole="button" accessibilityLabel="Refresh admin data">
            <Ionicons name="refresh" size={19} color={theme.color.onSurface} />
          </Pressable>
        </View>

        {checking ? <View style={styles.center}><ActivityIndicator color={theme.color.brand} /><Text style={styles.muted}>Checking admin access…</Text></View> : !allowed ? (
          <View style={styles.center} testID="admin-denied">
            <View style={styles.deniedIcon}><Ionicons name="lock-closed-outline" size={24} color={theme.color.onSurface2} /></View>
            <Text style={styles.cardTitle}>Admin access required</Text>
            <Text style={styles.mutedCenter}>{error || 'This account is not on the server admin allowlist.'}</Text>
            <Text style={styles.mutedCenter}>Ask the app owner to add your sign-in email to ADMIN_EMAILS on the backend service.</Text>
            <Pressable style={styles.primaryButton} onPress={() => router.back()} accessibilityRole="button"><Text style={styles.primaryText}>Back to app</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={styles.tabBar}>
              {(['overview', 'users', 'projects'] as AdminTab[]).map((item) => (
                <Pressable key={item} style={[styles.tab, tab === item && styles.tabOn]} onPress={() => selectTab(item)} accessibilityRole="button" accessibilityState={{ selected: tab === item }} testID={`admin-tab-${item}`}>
                  <Text style={[styles.tabText, tab === item && styles.tabTextOn]}>{item[0].toUpperCase() + item.slice(1)}</Text>
                </Pressable>
              ))}
            </View>
            <ScrollView contentContainerStyle={styles.content}>
              {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Pressable onPress={retry} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></Pressable></View>}
              {tab === 'overview' && <>
                <View style={styles.welcome}>
                  <View style={{ flex: 1 }}><Text style={styles.welcomeTitle}>App operations</Text><Text style={styles.muted}>A private overview of service readiness and recent work.</Text></View>
                  <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>ADMIN</Text></View>
                </View>
                {overview ? <>
                  <View style={styles.metrics}>
                    <View style={styles.metric}><Text style={styles.metricLabel}>TOTAL PROJECTS</Text><Text style={styles.metricValue}>{overview.project_count ?? '—'}</Text></View>
                    <View style={styles.metric}><Text style={styles.metricLabel}>CONNECTED SERVICES</Text><Text style={styles.metricValue}>{Object.values(overview.services || {}).filter(Boolean).length}<Text style={styles.metricUnit}> / {Object.keys(overview.services || {}).length}</Text></Text></View>
                  </View>
                  <Text style={styles.sectionTitle}>Service status</Text>
                  <Text style={styles.sectionTitle}>Service configuration</Text>
                  <View style={styles.card}>
                    {Object.entries(overview.services || {}).map(([key, ready]: [string, any]) => (
                      <View key={key} style={styles.serviceRow}>
                        <View style={[styles.serviceDot, ready ? styles.dotReady : styles.dotOff]} />
                        <Text style={styles.serviceName}>{SERVICE_LABELS[key] || key}</Text>
                        <Text style={[styles.serviceState, ready ? styles.textReady : styles.textOff]}>{ready ? 'Configured' : 'Needs setup'}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Recent projects</Text><Pressable onPress={() => selectTab('projects')} accessibilityRole="button"><Text style={styles.link}>View all</Text></Pressable></View>
                  {(overview.recent_projects || []).length ? overview.recent_projects.map((project: any) => <ProjectRow key={project.id} project={project} />) : <Empty text="No projects have been created yet." />}
                </> : loading ? <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View> : <Empty text="Admin overview is not available." />}
              </>}
              {tab !== 'overview' && <>
                <View style={styles.listHeading}><Text style={styles.sectionTitle}>{tab === 'users' ? 'Accounts' : 'Projects'}</Text><Text style={styles.muted}>Page {page}{tab === 'projects' && pageData?.total !== undefined ? ` · ${pageData.total} total` : ''}</Text></View>
                {loading ? <View style={styles.center}><ActivityIndicator color={theme.color.brand} /><Text style={styles.muted}>Loading {tab}…</Text></View>
                  : tab === 'users' ? (pageData?.items || []).length ? pageData!.items.map((account: any) => <UserRow key={account.id} account={account} />) : <Empty text="No accounts on this page." />
                    : (pageData?.items || []).length ? pageData!.items.map((project: any) => <ProjectRow key={project.id} project={project} />) : <Empty text="No projects on this page." />}
                <View style={styles.pager}>
                  <Pressable style={[styles.pageButton, page <= 1 && styles.pageDisabled]} disabled={page <= 1 || loading} onPress={() => setPage((value) => value - 1)} accessibilityRole="button"><Text style={styles.pageButtonText}>Previous</Text></Pressable>
                  <Pressable style={[styles.pageButton, pageData?.has_more === false && styles.pageDisabled]} disabled={!pageData?.has_more || loading} onPress={() => setPage((value) => value + 1)} accessibilityRole="button"><Text style={styles.pageButtonText}>Next</Text></Pressable>
                </View>
              </>}
              <Text style={styles.footerNote}>Read-only operations panel · Sensitive media and secret keys are not shown.</Text>
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

function UserRow({ account }: { account: any }) {
  return <View style={styles.cardRow}>
    <View style={[styles.rowIcon, account.is_admin && styles.adminIcon]}><Ionicons name={account.is_admin ? 'shield-checkmark-outline' : 'person-outline'} size={19} color={account.is_admin ? theme.color.brand : theme.color.onSurface2} /></View>
    <View style={styles.rowCopy}><Text style={styles.rowTitle} numberOfLines={1}>{account.name}</Text><Text style={styles.rowSub} numberOfLines={1}>{account.email || 'No email'}</Text><Text style={styles.rowMeta}>Joined {formatDate(account.created_at)}{account.last_sign_in_at ? ` · Last sign-in ${formatDate(account.last_sign_in_at)}` : ''}</Text></View>
    {account.is_admin ? <Text style={styles.adminBadge}>ADMIN</Text> : null}
  </View>;
}

function ProjectRow({ project }: { project: any }) {
  return <View style={styles.cardRow}>
    <View style={styles.rowIcon}><Ionicons name="film-outline" size={20} color={theme.color.brand} /></View>
    <View style={styles.rowCopy}><Text style={styles.rowTitle} numberOfLines={1}>{project.title}</Text><Text style={styles.rowSub}>{project.shoot_type} · {project.status} · {project.clip_count} clips</Text><Text style={styles.rowMeta}>Updated {formatDate(project.updated_at || project.created_at)} · Owner {String(project.user_id || '').slice(0, 8) || '—'}</Text></View>
  </View>;
}

function Empty({ text }: { text: string }) {
  return <View style={styles.empty}><Ionicons name="file-tray-outline" size={24} color={theme.color.onSurface3} /><Text style={styles.muted}>{text}</Text></View>;
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface }, safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 6, paddingBottom: 18, gap: 12 },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  headerCopy: { flex: 1 }, eyebrow: { color: theme.color.brand, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }, title: { color: theme.color.onSurface, fontSize: 24, fontWeight: '800', marginTop: 2 },
  refresh: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  tabBar: { flexDirection: 'row', marginHorizontal: 18, padding: 4, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  tab: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, tabOn: { backgroundColor: theme.color.brand }, tabText: { color: theme.color.onSurface2, fontWeight: '700', fontSize: 13 }, tabTextOn: { color: '#fff' },
  content: { padding: 18, paddingBottom: 44, gap: 12 }, welcome: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 }, welcomeTitle: { color: theme.color.onSurface, fontSize: 19, fontWeight: '700', marginBottom: 4 }, muted: { color: theme.color.onSurface3, fontSize: 12, lineHeight: 18 }, mutedCenter: { color: theme.color.onSurface2, fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 430 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: theme.color.brandTint, borderRadius: theme.radius.pill }, liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color.brand }, liveText: { color: theme.color.brand, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  metrics: { flexDirection: 'row', gap: 10 }, metric: { flex: 1, padding: 15, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border }, metricLabel: { color: theme.color.onSurface3, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }, metricValue: { color: theme.color.onSurface, fontSize: 26, fontWeight: '800', marginTop: 8 }, metricUnit: { color: theme.color.onSurface3, fontSize: 15, fontWeight: '600' },
  sectionTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: '700' }, card: { borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 14 }, serviceRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.divider }, serviceDot: { width: 8, height: 8, borderRadius: 4 }, dotReady: { backgroundColor: theme.color.success }, dotOff: { backgroundColor: theme.color.onSurface3 }, serviceName: { color: theme.color.onSurface, flex: 1, fontSize: 13, fontWeight: '600' }, serviceState: { fontSize: 11, fontWeight: '700' }, textReady: { color: theme.color.success }, textOff: { color: theme.color.onSurface3 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }, link: { color: theme.color.brand, fontWeight: '700', fontSize: 13 }, listHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 6 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border, marginBottom: 8, minHeight: 74 }, rowIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: theme.color.surface3, alignItems: 'center', justifyContent: 'center' }, adminIcon: { backgroundColor: theme.color.brandTint }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: '700' }, rowSub: { color: theme.color.onSurface2, fontSize: 12, marginTop: 3, textTransform: 'capitalize' }, rowMeta: { color: theme.color.onSurface3, fontSize: 10, marginTop: 4 }, adminBadge: { color: theme.color.brand, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  pager: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }, pageButton: { minWidth: 104, paddingHorizontal: 14, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surface2 }, pageDisabled: { opacity: 0.4 }, pageButtonText: { color: theme.color.onSurface, fontSize: 12, fontWeight: '700' },
  errorBox: { padding: 14, borderRadius: theme.radius.md, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.28)', gap: 6 }, errorText: { color: theme.color.error, fontSize: 13 }, retryText: { color: theme.color.brand, fontWeight: '700', fontSize: 12 }, empty: { minHeight: 100, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14 }, footerNote: { color: theme.color.onSurface3, textAlign: 'center', fontSize: 10, marginTop: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }, deniedIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface2 }, cardTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: '700', textAlign: 'center' }, primaryButton: { marginTop: 8, paddingHorizontal: 20, height: 44, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#fff', fontWeight: '700' },
});
