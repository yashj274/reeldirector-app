import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/src/api';
import { theme } from '@/src/theme';

export default function Projects() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.listProjects()); } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.root} testID="projects-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Projects</Text>
          <Pressable style={styles.newBtn} onPress={() => router.push('/project/new')} testID="projects-new-button">
            <Ionicons name="add" size={20} color="#fff" />
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="albums-outline" size={44} color={theme.color.onSurface3} />
            <Text style={styles.emptyText}>No projects yet. Tap + to create one.</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 12 }}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.color.brand}
              onRefresh={() => { setRefreshing(true); load(); }} />}
            renderItem={({ item }) => (
              <Pressable style={styles.card} onPress={() => router.push(`/project/${item.id}`)} testID={`projects-row-${item.id}`}>
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
                    <Text style={styles.badgeText}>{item.status}</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.color.onSurface3} />
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
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
});
