import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const extra = Constants.expoConfig?.extra ?? {};
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || '';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || extra.supabasePublishableKey || '';

let client: SupabaseClient | null = null;

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

export function getSupabase(): SupabaseClient {
  if (!hasSupabaseConfig()) {
    throw new Error('Supabase is not configured. Add the project URL and publishable key to frontend/.env.local, then restart the app.');
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
        autoRefreshToken: true,
        persistSession: true,
        // The /auth/callback route exchanges confirmation codes on both web and native.
        // Avoid a second automatic exchange racing that route on web.
        detectSessionInUrl: false,
      },
    });

    if (Platform.OS !== 'web') {
      AppState.addEventListener('change', (state) => {
        if (state === 'active') client?.auth.startAutoRefresh();
        else client?.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}
