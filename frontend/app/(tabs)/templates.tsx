import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/src/api';
import { theme } from '@/src/theme';

export default function Templates() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => { api.templates().then(setItems).catch(() => {}); }, []);

  return (
    <View style={styles.root} testID="templates-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Templates</Text>
          <Text style={styles.sub}>Pick a look. AI handles the rest.</Text>
        </View>
        <FlatList
          data={items}
          keyExtractor={(t) => t.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 12 }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.tpl}
              onPress={() => router.push({ pathname: '/project/new', params: { template: item.id, mood: item.mood, style: item.style, duration: String(item.duration) } })}
              testID={`templates-card-${item.id}`}
            >
              <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <LinearGradient colors={['transparent', 'rgba(10,11,14,0.92)']} style={StyleSheet.absoluteFill} />
              <View style={styles.tplText}>
                <Text style={styles.tplName}>{item.name}</Text>
                <Text style={styles.tplMeta}>{item.mood} · {item.duration}s</Text>
              </View>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { color: theme.color.onSurface, fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  sub: { color: theme.color.onSurface2, fontSize: 14, marginTop: 4 },
  tpl: { flex: 1, aspectRatio: 0.75, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.color.surface2 },
  tplText: { position: 'absolute', bottom: 14, left: 14, right: 14 },
  tplName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  tplMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 10, marginTop: 4, letterSpacing: 1, textTransform: 'uppercase' },
});
