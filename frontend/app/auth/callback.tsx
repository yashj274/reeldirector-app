import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { EmailOtpType } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { getSupabase } from '@/src/supabase';
import { theme } from '@/src/theme';

function paramsFromUrl(url: string) {
  const [withoutHash, hash = ''] = url.split('#', 2);
  const query = new URLSearchParams(withoutHash.split('?')[1] || '');
  const fragment = new URLSearchParams(hash);
  return {
    code: query.get('code'),
    tokenHash: query.get('token_hash') || fragment.get('token_hash'),
    type: query.get('type') || fragment.get('type'),
    accessToken: query.get('access_token') || fragment.get('access_token'),
    refreshToken: query.get('refresh_token') || fragment.get('refresh_token'),
    next: query.get('next'),
    errorDescription: query.get('error_description') || fragment.get('error_description'),
  };
}

export default function AuthCallback() {
  const router = useRouter();
  const handledUrl = useRef('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const finish = async (url: string) => {
      if (!url || handledUrl.current === url) return;
      handledUrl.current = url;
      try {
        const params = paramsFromUrl(url);
        if (params.errorDescription) throw new Error(params.errorDescription);
        const auth = getSupabase().auth;
        let authError: Error | null = null;
        if (params.code) {
          const result = await auth.exchangeCodeForSession(params.code);
          authError = result.error;
        } else if (params.tokenHash && params.type) {
          const result = await auth.verifyOtp({
            token_hash: params.tokenHash,
            type: params.type as EmailOtpType,
          });
          authError = result.error;
        } else if (params.accessToken && params.refreshToken) {
          const result = await auth.setSession({
            access_token: params.accessToken,
            refresh_token: params.refreshToken,
          });
          authError = result.error;
        } else {
          const result = await auth.getSession();
          if (!result.data.session) throw new Error('The sign-in link is missing or has expired. Request a new one.');
          authError = result.error;
        }
        if (authError) throw authError;
        const destination = params.next === '/(auth)/reset-password?mode=update'
          ? '/(auth)/reset-password?mode=update'
          : '/(tabs)/dashboard';
        if (active) router.replace(destination as any);
      } catch (cause: any) {
        if (active) setError(cause?.message || 'Could not complete sign-in. Request a new confirmation link.');
      }
    };

    const subscription = Linking.addEventListener('url', ({ url }) => { void finish(url); });
    const initialUrl = Platform.OS === 'web' && typeof window !== 'undefined'
      ? Promise.resolve(window.location.href)
      : Linking.getInitialURL();
    void initialUrl.then((url) => {
      if (url) return finish(url);
      return getSupabase().auth.getSession().then(({ data, error: sessionError }) => {
        if (!active) return;
        if (!sessionError && data.session) router.replace('/(tabs)/dashboard');
        else setError('Open the confirmation link from your email to finish signing in.');
      });
    }).catch((cause: any) => {
      if (active) setError(cause?.message || 'Could not read the sign-in link.');
    });
    return () => { active = false; subscription.remove(); };
  }, [router]);

  return (
    <View style={styles.root}>
      {error ? (
        <>
          <Text style={styles.title}>Sign-in link issue</Text>
          <Text style={styles.message} accessibilityRole="alert">{error}</Text>
          <Pressable style={styles.button} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.buttonText}>Back to sign in</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color={theme.color.brand} />
          <Text style={styles.message}>Finishing sign-in…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 },
  title: { color: theme.color.onSurface, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  message: { color: theme.color.onSurface2, lineHeight: 22, textAlign: 'center' },
  button: { marginTop: 8, paddingHorizontal: 20, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
