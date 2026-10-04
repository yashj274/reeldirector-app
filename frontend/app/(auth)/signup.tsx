import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, friendlyAuthError } from '@/src/api';
import { theme } from '@/src/theme';
import { useT } from '@/src/i18n';

export default function Signup() {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    if (!name || !email || !password) { setErr('Fill all fields'); return; }
    if (password.length < 6) { setErr('Password must be 6+ characters'); return; }
    setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await api.signup(email.trim().toLowerCase(), password, name);
      if (r.requiresEmailConfirmation) {
        setInfo('Account created. Check your email to confirm it, then sign in.');
        return;
      }
      router.replace('/(tabs)/dashboard');
    } catch (e: any) { setErr(friendlyAuthError(e, 'create account')); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root} testID="signup-screen">
      <Image
        source={{ uri: 'https://images.unsplash.com/photo-1534196213718-bd643e406be4' }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient colors={['rgba(10,11,14,0.5)', 'rgba(10,11,14,0.95)', theme.color.surface]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', padding: 24 }}>
            <Text style={styles.brand}>ReelDirector</Text>
            <Text style={styles.title}>{t('create_account_title')}</Text>
            <Text style={styles.sub}>{t('signup_subtitle')}</Text>

            <View style={styles.input}>
              <TextInput value={name} onChangeText={setName} placeholder={t('full_name')}
                placeholderTextColor={theme.color.onSurface3} style={styles.text}
                testID="signup-name-input" />
            </View>
            <View style={styles.input}>
              <TextInput value={email} onChangeText={setEmail} placeholder={t('email')}
                placeholderTextColor={theme.color.onSurface3} autoCapitalize="none"
                keyboardType="email-address" style={styles.text}
                testID="signup-email-input" />
            </View>
            <View style={styles.input}>
              <TextInput value={password} onChangeText={setPassword} placeholder={`${t('password')} (6+)`}
                placeholderTextColor={theme.color.onSurface3} secureTextEntry style={styles.text}
                testID="signup-password-input" />
            </View>

            {err && <Text style={styles.err} testID="signup-error">{err}</Text>}
            {info && <Text style={styles.info} testID="signup-info">{info}</Text>}

            <Pressable style={styles.primary} onPress={submit} disabled={busy} testID="signup-submit-button">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{t('create_account')}</Text>}
            </Pressable>

            <Pressable onPress={() => router.replace('/(auth)/login')} testID="signup-goto-login">
              <Text style={styles.link}>{t('have_account')} <Text style={{ color: theme.color.brand }}>{t('sign_in')}</Text></Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  brand: { color: theme.color.onSurface, fontSize: 20, fontWeight: '600', marginBottom: 40, letterSpacing: -0.5 },
  title: { color: theme.color.onSurface, fontSize: 36, fontWeight: '700', letterSpacing: -1 },
  sub: { color: theme.color.onSurface2, fontSize: 15, marginTop: 8, marginBottom: 32 },
  input: {
    backgroundColor: theme.color.surface3, borderRadius: theme.radius.md,
    paddingHorizontal: 16, marginBottom: 12, height: 56, justifyContent: 'center',
    borderWidth: 1, borderColor: theme.color.border,
  },
  text: { color: theme.color.onSurface, fontSize: 16 },
  primary: {
    marginTop: 12, height: 56, borderRadius: theme.radius.md,
    backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { color: theme.color.onSurface2, textAlign: 'center', marginTop: 20 },
  err: { color: theme.color.error, marginBottom: 8 },
  info: { color: theme.color.brand, marginBottom: 8 },
});
