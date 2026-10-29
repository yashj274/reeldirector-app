import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { LogBox, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@/src/api';

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  useEffect(() => { void api.warmBackend(); }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0B0E' }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#0A0B0E" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0A0B0E' },
            animation: 'fade',
          }}
        />
      </SafeAreaProvider>
    </View>
  );
}
