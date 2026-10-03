import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LANGUAGES, getLanguage, setLanguage } from '@/src/i18n';
import { theme } from '@/src/theme';

export default function SettingsLanguage() {
  const router = useRouter();
  const [sel, setSel] = useState<string>('en');
  useEffect(() => { getLanguage().then(setSel); }, []);

  const save = async (code: string) => {
    setSel(code);
    await setLanguage(code);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }} testID="settings-language-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="settings-language-back">
            <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title}>Language</Text>
          <View style={{ width: 26 }} />
        </View>
        <FlatList
          data={LANGUAGES}
          keyExtractor={(l) => l.code}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const on = sel === item.code;
            return (
              <Pressable style={[styles.row, on && styles.rowOn]} onPress={() => save(item.code)} testID={`settings-lang-${item.code}`}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, on && { color: theme.color.brand }]}>{item.native}</Text>
                  <Text style={styles.sub}>{item.name}</Text>
                </View>
                {on && <Ionicons name="checkmark-circle" size={22} color={theme.color.brand} />}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { flex: 1, textAlign: 'center', color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', padding: 14, borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, marginBottom: 8, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center' },
  rowOn: { borderColor: theme.color.brand, backgroundColor: theme.color.brandTint },
  name: { color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  sub: { color: theme.color.onSurface3, fontSize: 12, marginTop: 2 },
});
