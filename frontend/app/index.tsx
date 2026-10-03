import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { getToken } from '@/src/api';
import { isOnboarded } from '@/src/i18n';

export default function AppEntry() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void Promise.all([getToken(), isOnboarded()])
      .then(([token, onboarded]) => {
        if (!active) return;
        if (!onboarded) router.replace('/(auth)/language');
        else router.replace(token ? '/(tabs)/dashboard' : '/(auth)/login');
      })
      .catch(() => {
        if (active) router.replace('/(auth)/login');
      });
    return () => { active = false; };
  }, [router]);

  return <View style={{ flex: 1, backgroundColor: '#0A0B0E' }} testID="app-entry" />;
}
