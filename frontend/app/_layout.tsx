import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { LogBox, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@/src/api';

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  useEffect(() => { void api.warmBackend(); }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0A0B0E' }}>
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
    </GestureHandlerRootView>
  );
}
