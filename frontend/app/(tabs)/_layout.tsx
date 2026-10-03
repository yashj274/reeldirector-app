import { useEffect, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { getToken } from '@/src/api';
import { theme } from '@/src/theme';

export default function TabsLayout() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let mounted = true;
    getToken().then((token) => {
      if (!mounted) return;
      if (token) setAuthChecked(true);
      else router.replace('/(auth)/login');
    }).catch(() => {
      if (mounted) router.replace('/(auth)/login');
    });
    return () => { mounted = false; };
  }, [router]);

  if (!authChecked) return <View style={{ flex: 1, backgroundColor: theme.color.surface }} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.brand,
        tabBarInactiveTintColor: theme.color.onSurface3,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'rgba(10,11,14,0.85)',
          borderTopColor: theme.color.border,
          borderTopWidth: 0.5,
          height: 82,
          paddingTop: 8,
          paddingBottom: 24,
        },
        tabBarBackground: () => (
          <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,11,14,0.75)' }]} />
          </BlurView>
        ),
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="dashboard" options={{
        title: 'Home',
        tabBarIcon: ({ color, size }) => <Ionicons name="film-outline" size={size} color={color} />,
      }} />
      <Tabs.Screen name="projects" options={{
        title: 'Projects',
        tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" size={size} color={color} />,
      }} />
      <Tabs.Screen name="templates" options={{
        title: 'Templates',
        tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" size={size} color={color} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profile',
        tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
      }} />
    </Tabs>
  );
}
