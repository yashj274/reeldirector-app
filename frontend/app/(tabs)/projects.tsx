import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { useT } from '@/src/i18n';

export default function Projects() {
  const t = useT();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = useCallback(async () => {
    try { setItems(await api.listProjects()); } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteProject(pendingDelete.id);
      setItems((current) => current.filter((project) => project.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (error: any) {
      setDeleteError(error?.message || t('delete_project_failed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={styles.root} testID="projects-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('all_projects')}</Text>
          <Pressable style={styles.newBtn} onPress={() => router.push('/project/new')} testID="projects-new-button">
            <Ionicons name="add" size={20} color="#fff" />
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="albums-outline" size={44} color={theme.color.onSurface3} />
            <Text style={styles.emptyText}>{t('no_projects')}</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 12 }}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.color.brand}
              onRefresh={() => { setRefreshing(true); load(); }} />}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Pressable
                  style={styles.cardMain}
                  onPress={() => router.push(`/project/${item.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                  testID={`projects-row-${item.id}`}>
                  <View style={styles.thumb}>
                    {item.thumbnail_url ? (
                      <Image source={{ uri: item.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <Ionicons name="film" size={22} color={theme.color.onSurface3} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.meta}>{item.shoot_type} · {item.duration_seconds}s · {item.style}</Text>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{t(`project_status_${item.status}`)}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.color.onSurface3} />
                </Pressable>
                <Pressable
                  style={styles.deleteButton}
                  onPress={() => { setDeleteError(''); setPendingDelete(item); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('delete_project')}: ${item.title}`}
                  testID={`projects-delete-${item.id}`}>
                  <Ionicons name="trash-outline" size={19} color={theme.color.error} />
                </Pressable>
              </View>
            )}
          />
        )}
      </SafeAreaView>

      <Modal
        visible={Boolean(pendingDelete)}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!deleting) setPendingDelete(null); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.confirmCard} accessibilityViewIsModal>
            <View style={styles.deleteIcon}>
              <Ionicons name="trash-outline" size={22} color={theme.color.error} />
            </View>
            <Text style={styles.confirmTitle}>{t('delete_project')}</Text>
            <Text style={styles.confirmCopy}>
              {t('delete_project_confirm').replace('{title}', pendingDelete?.title || '')}
            </Text>
            {deleteError ? <Text style={styles.deleteError} accessibilityRole="alert">{deleteError}</Text> : null}
            <View style={styles.confirmActions}>
              <Pressable
                style={[styles.actionButton, styles.cancelButton]}
                onPress={() => setPendingDelete(null)}
                disabled={deleting}
                accessibilityRole="button"
                testID="cancel-delete-project">
                <Text style={styles.cancelText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.confirmDeleteButton, deleting && styles.disabledButton]}
                onPress={confirmDelete}
                disabled={deleting}
                accessibilityRole="button"
                testID="confirm-delete-project">
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmDeleteText}>{t('delete_project_action')}</Text>}
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { flex: 1, color: theme.color.onSurface, fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: 40, alignItems: 'center', gap: 12, marginTop: 40 },
  emptyText: { color: theme.color.onSurface2 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: 12, borderWidth: 1, borderColor: theme.color.border,
  },
  cardMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  deleteButton: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  thumb: {
    width: 64, height: 64, borderRadius: 10, backgroundColor: theme.color.surface3,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  name: { color: theme.color.onSurface, fontWeight: '600', fontSize: 15 },
  meta: { color: theme.color.onSurface3, fontSize: 12, marginTop: 3, textTransform: 'capitalize' },
  badge: {
    alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: theme.radius.pill, backgroundColor: theme.color.brandTint,
  },
  badgeText: { color: theme.color.brand, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  confirmCard: {
    width: '100%', maxWidth: 420, borderRadius: theme.radius.lg, padding: 24,
    backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border,
  },
  deleteIcon: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(239,68,68,0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  confirmTitle: { color: theme.color.onSurface, fontSize: 20, fontWeight: '700' },
  confirmCopy: { color: theme.color.onSurface2, fontSize: 14, lineHeight: 21, marginTop: 8 },
  deleteError: { color: theme.color.error, fontSize: 13, lineHeight: 19, marginTop: 12 },
  confirmActions: { flexDirection: 'row', gap: 10, marginTop: 24 },
  actionButton: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  cancelButton: { backgroundColor: theme.color.surface3 },
  cancelText: { color: theme.color.onSurface, fontSize: 14, fontWeight: '600' },
  confirmDeleteButton: { backgroundColor: theme.color.error },
  confirmDeleteText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  disabledButton: { opacity: 0.65 },
});
