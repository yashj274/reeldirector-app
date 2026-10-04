import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = { movement?: string; label: string; movementLabel?: string };

const movementIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  pan_left: 'arrow-back', pan_right: 'arrow-forward', tilt_up: 'arrow-up', tilt_down: 'arrow-down',
  dolly_in: 'arrow-up', dolly_out: 'arrow-down', tracking: 'arrow-forward', reveal: 'eye-outline',
  orbit: 'refresh', handheld: 'hand-left-outline', static: 'remove',
};

export function MovementGuide({ movement = 'static', label, movementLabel }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const normalized = movement.toLowerCase().replace(/\s+/g, '_');
  const loopAnimation = useMemo(() => {
    const outward = Animated.timing(progress, {
      toValue: 1, duration: normalized === 'static' ? 1100 : 1500,
      easing: Easing.inOut(Easing.ease), useNativeDriver: true,
    });
    const inward = Animated.timing(progress, {
      toValue: 0, duration: normalized === 'static' ? 1100 : 1500,
      easing: Easing.inOut(Easing.ease), useNativeDriver: true,
    });
    return Animated.loop(Animated.sequence([outward, inward]));
  }, [normalized, progress]);

  useEffect(() => {
    loopAnimation.start();
    return () => loopAnimation.stop();
  }, [loopAnimation]);

  const translateX = normalized === 'pan_left' || normalized === 'tracking'
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [18, -18] })
    : normalized === 'pan_right' ? progress.interpolate({ inputRange: [0, 1], outputRange: [-18, 18] }) : 0;
  const translateY = normalized === 'tilt_up' || normalized === 'dolly_in'
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [12, -12] })
    : normalized === 'tilt_down' || normalized === 'dolly_out'
      ? progress.interpolate({ inputRange: [0, 1], outputRange: [-12, 12] }) : 0;
  const rotate = normalized === 'orbit' || normalized === 'handheld'
    ? progress.interpolate({ inputRange: [0, 1], outputRange: normalized === 'orbit' ? ['-10deg', '10deg'] : ['-3deg', '3deg'] }) : '0deg';
  const scale = normalized === 'dolly_in' || normalized === 'reveal'
    ? progress.interpolate({ inputRange: [0, 1], outputRange: normalized === 'reveal' ? [0.84, 1.08] : [0.88, 1.12] })
    : normalized === 'dolly_out' ? progress.interpolate({ inputRange: [0, 1], outputRange: [1.12, 0.88] }) : 1;

  return (
    <View pointerEvents="none" style={styles.wrap} accessibilityLabel={`${label}: ${movementLabel || movement.replace(/_/g, ' ')}`}>
      <Animated.View style={[styles.deviceAndHand, { transform: [{ translateX }, { translateY }, { rotate }, { scale }] }]}>
        <View style={styles.phone}>
          <View style={styles.screen}>
            <Ionicons name={movementIcons[normalized] || 'hand-left-outline'} size={30} color="rgba(255,255,255,0.82)" />
            <View style={styles.cameraDot} />
          </View>
        </View>
        <View style={styles.hand}>
          <Ionicons name="hand-left-outline" size={32} color="rgba(255,255,255,0.76)" />
        </View>
      </Animated.View>
      <Text style={styles.label}>{movementLabel || movement.replace(/_/g, ' ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignSelf: 'center', top: '37%', alignItems: 'center', opacity: 0.25, zIndex: 1 },
  deviceAndHand: { width: 58, height: 102 },
  phone: { width: 58, height: 102, padding: 4, borderRadius: 13, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'rgba(0,0,0,0.26)' },
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
  cameraDot: { position: 'absolute', top: 5, width: 8, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.55)' },
  hand: { position: 'absolute', bottom: -24, right: -22 },
  label: { color: '#fff', fontSize: 12, fontWeight: '700', textTransform: 'capitalize', marginTop: 7, textShadowColor: '#000', textShadowRadius: 3 },
});
