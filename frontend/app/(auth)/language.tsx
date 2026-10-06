import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { LANGUAGES, getLanguage, setLanguage, markOnboarded, useT } from '@/src/i18n';
import { CreatorSkillLevel, getCreatorSkillLevel, setCreatorSkillLevel } from '@/src/api';
import { theme } from '@/src/theme';

export default function LanguagePick() {
  const t = useT();
  const router = useRouter();
  const [sel, setSel] = useState<string>('en');
  const [skill, setSkill] = useState<CreatorSkillLevel>('beginner');

  useEffect(() => {
    void Promise.all([getLanguage(), getCreatorSkillLevel()]).then(([language, level]) => {
      setSel(language);
      setSkill(level);
    });
  }, []);

  const done = async () => {
    await setLanguage(sel);
    await setCreatorSkillLevel(skill);
    await markOnboarded();
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.root} testID="onboarding-language-screen">
      <LinearGradient
        colors={[theme.color.brandTint, theme.color.surface, theme.color.surface]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('choose_language')}</Text>
          <Text style={styles.sub}>{t('language_subtitle')}</Text>
          <Text style={styles.skillTitle}>{t('creator_skill_level')}</Text>
          <Text style={styles.skillSub}>{t('skill_help')}</Text>
          <View style={styles.skillRow} testID="onboarding-skill-level">
            {(['beginner', 'creator', 'pro'] as CreatorSkillLevel[]).map((level) => (
              <Pressable key={level} onPress={() => setSkill(level)}
                style={[styles.skillChip, skill === level && styles.skillChipOn]}
                accessibilityRole="button" accessibilityState={{ selected: skill === level }}
                testID={`onboarding-skill-${level}`}>
                <Text style={[styles.skillText, skill === level && styles.skillTextOn]}>{t(level)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <FlatList
          data={LANGUAGES}
          keyExtractor={(l) => l.code}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          renderItem={({ item }) => {
            const active = sel === item.code;
            return (
              <Pressable
                style={[styles.row, active && styles.rowOn]}
                onPress={() => { setSel(item.code); void setLanguage(item.code); }}
                testID={`lang-option-${item.code}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, active && { color: theme.color.brand }]}>{item.native}</Text>
                  <Text style={styles.sub2}>{item.name}</Text>
                </View>
                {active && <Ionicons name="checkmark-circle" size={22} color={theme.color.brand} />}
              </Pressable>
            );
          }}
        />
        <View style={styles.footer}>
          <Pressable style={styles.primary} onPress={done} testID="onboarding-continue">
            <Text style={styles.primaryText}>{t('continue')}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 14 },
  title: { color: theme.color.onSurface, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  sub: { color: theme.color.onSurface2, marginTop: 8, fontSize: 14 },
  skillTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: '700', marginTop: 18 },
  skillSub: { color: theme.color.onSurface3, fontSize: 12, marginTop: 4 },
  skillRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  skillChip: { flex: 1, minHeight: 40, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface2, alignItems: 'center', justifyContent: 'center' },
  skillChipOn: { borderColor: theme.color.brand, backgroundColor: theme.color.brandTint },
  skillText: { color: theme.color.onSurface2, fontSize: 13, fontWeight: '600' },
  skillTextOn: { color: theme.color.brand },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: theme.radius.md, backgroundColor: theme.color.surface2, marginBottom: 8,
    borderWidth: 1, borderColor: theme.color.border,
  },
  rowOn: { borderColor: theme.color.brand, backgroundColor: theme.color.brandTint },
  name: { color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  sub2: { color: theme.color.onSurface3, fontSize: 12, marginTop: 2 },
  footer: { position: 'absolute', bottom: 24, left: 24, right: 24 },
  primary: { height: 56, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
