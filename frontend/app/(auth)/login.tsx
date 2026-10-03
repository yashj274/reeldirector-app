import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, friendlyAuthError } from '@/src/api';
import { theme } from '@/src/theme';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!email || !password) { setErr('Enter email and password'); return; }
    setBusy(true); setErr(null);
    try {
      await api.login(email.trim().toLowerCase(), password);
      router.replace('/(tabs)/dashboard');
    } catch (e: any) { setErr(friendlyAuthError(e, 'sign in')); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <Image
        source={{ uri: 'https://images.pexels.com/photos/13327382/pexels-photo-13327382.jpeg?auto=compress&cs=tinysrgb&h=1400&w=940' }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient colors={['rgba(10,11,14,0.5)', 'rgba(10,11,14,0.95)', theme.color.surface]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end', padding: 24 }}
        >
          <Text style={styles.brand}>ReelDirector</Text>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.sub}>Sign in to keep directing.</Text>

          <View style={styles.input}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={theme.color.onSurface3}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.text}
              testID="login-email-input"
            />
          </View>
          <View style={styles.input}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.color.onSurface3}
              secureTextEntry
              style={styles.text}
              testID="login-password-input"
            />
          </View>

          {err && <Text style={styles.err} testID="login-error">{err}</Text>}

          <Pressable style={styles.primary} onPress={submit} disabled={busy} testID="login-submit-button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Sign in</Text>}
          </Pressable>

          <Pressable onPress={() => router.push('/(auth)/signup')} testID="login-goto-signup">
            <Text style={styles.link}>New here? <Text style={{ color: theme.color.brand }}>Create an account</Text></Text>
          </Pressable>
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
});
