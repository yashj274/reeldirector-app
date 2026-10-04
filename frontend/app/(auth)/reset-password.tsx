import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/src/api';
import { getSupabase } from '@/src/supabase';
import { theme } from '@/src/theme';
import { useT } from '@/src/i18n';

export default function ResetPassword() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const t = useT();
  const updating = mode === 'update';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(updating);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!updating) return;
    let active = true;
    void getSupabase().auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      setHasRecoverySession(!sessionError && !!data.session);
      setCheckingSession(false);
    });
    return () => { active = false; };
  }, [updating]);

  const submit = async () => {
    setMessage(''); setError('');
    if (updating && !hasRecoverySession) {
      setError(t('password_reset_expired'));
      return;
    }
    if (updating && password.length < 8) { setError(t('password_min_error')); return; }
    if (updating && password !== confirm) { setError(t('password_mismatch')); return; }
    if (!updating && !email.includes('@')) { setError(t('reset_email_required')); return; }
    setBusy(true);
    try {
      if (updating) {
        await api.updatePassword(password);
        setMessage(t('password_changed'));
        setTimeout(() => router.replace('/(auth)/login'), 900);
      } else {
        await api.requestPasswordReset(email.trim().toLowerCase());
        setMessage(t('reset_email_sent'));
      }
    } catch (cause: any) {
      setError(cause?.message || t('could_not_update_password'));
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.root} testID="reset-password-screen">
      <LinearGradient colors={[theme.color.brandTint, theme.color.surface, theme.color.surface]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.content}>
          <Pressable onPress={() => router.replace('/(auth)/login')}><Text style={styles.back}>‹  {t('sign_in')}</Text></Pressable>
          <Text style={styles.title}>{updating ? t('reset_password') : t('forgot_password')}</Text>
          <Text style={styles.subtitle}>{updating ? t('choose_password_copy') : t('email_reset_copy')}</Text>

          {checkingSession ? <ActivityIndicator color={theme.color.brand} /> : updating && !hasRecoverySession ? (
            <View style={{ gap: 14 }}>
              <Text style={styles.error}>{t('password_reset_expired')}</Text>
              <Pressable style={styles.primary} onPress={() => router.replace('/(auth)/reset-password' as any)}><Text style={styles.primaryText}>{t('request_another_link')}</Text></Pressable>
            </View>
          ) : (
            <>
              {updating ? <>
                <View style={styles.input}><TextInput value={password} onChangeText={setPassword} placeholder={t('new_password')} placeholderTextColor={theme.color.onSurface3} secureTextEntry style={styles.text} testID="reset-new-password" /></View>
                <View style={styles.input}><TextInput value={confirm} onChangeText={setConfirm} placeholder={t('confirm_new_password')} placeholderTextColor={theme.color.onSurface3} secureTextEntry style={styles.text} testID="reset-confirm-password" /></View>
              </> : <View style={styles.input}><TextInput value={email} onChangeText={setEmail} placeholder={t('email')} placeholderTextColor={theme.color.onSurface3} autoCapitalize="none" keyboardType="email-address" style={styles.text} testID="reset-email" /></View>}
              {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
              {!!message && <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text>}
              <Pressable style={styles.primary} onPress={submit} disabled={busy} testID="reset-submit">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{updating ? t('update_password') : t('send_reset_link')}</Text>}
              </Pressable>
            </>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  content: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  back: { color: theme.color.onSurface2, fontSize: 15, marginBottom: 18 },
  title: { color: theme.color.onSurface, fontSize: 30, fontWeight: '800' },
  subtitle: { color: theme.color.onSurface2, fontSize: 15, lineHeight: 22, marginBottom: 8 },
  input: { backgroundColor: theme.color.surface3, borderRadius: theme.radius.md, paddingHorizontal: 16, height: 56, justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border },
  text: { color: theme.color.onSurface, fontSize: 16 },
  primary: { height: 56, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: theme.color.error, lineHeight: 20 },
  message: { color: theme.color.success, lineHeight: 20 },
});
