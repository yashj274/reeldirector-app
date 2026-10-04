import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = { movement?: string; label: string; movementLabel?: string };

const movementIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  pan_left: 'arrow-back', pan_right: 'arrow-forward', tilt_up: 'arrow-up', tilt_down: 'arrow-down',
  dolly_in: 'add', dolly_out: 'remove', tracking: 'person-outline', reveal: 'eye-outline',
  orbit: 'refresh', handheld: 'hand-left-outline', static: 'pause',
};

export function MovementGuide({ movement = 'static', label, movementLabel }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const normalized = movement.toLowerCase().trim().replace(/[\s-]+/g, '_');
  const loopAnimation = useMemo(() => {
    const outward = Animated.timing(progress, {
      toValue: 1, duration: normalized === 'static' ? 950 : 1450,
      easing: Easing.inOut(Easing.ease), useNativeDriver: true,
    });
    const inward = Animated.timing(progress, {
      toValue: 0, duration: normalized === 'static' ? 950 : 1450,
      easing: Easing.inOut(Easing.ease), useNativeDriver: true,
    });
    const reset = Animated.timing(progress, { toValue: 0, duration: 1, useNativeDriver: true });
    const sequence = normalized === 'static' || normalized === 'handheld'
      ? [outward, inward]
      : [outward, Animated.delay(650), reset];
    return Animated.loop(Animated.sequence(sequence));
  }, [normalized, progress]);

  useEffect(() => {
    loopAnimation.start();
    return () => loopAnimation.stop();
  }, [loopAnimation]);

  const xRange = normalized === 'pan_left' ? [18, -18]
    : normalized === 'pan_right' || normalized === 'tracking' || normalized === 'reveal' ? [-18, 18]
      : normalized === 'orbit' ? [-12, 12] : [0, 0];
  const yRange = normalized === 'tilt_up' ? [14, -14]
    : normalized === 'tilt_down' ? [-14, 14] : [0, 0];
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: xRange });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: yRange });
  const rotate = normalized === 'orbit' || normalized === 'handheld'
    ? progress.interpolate({ inputRange: [0, 1], outputRange: normalized === 'orbit' ? ['-12deg', '12deg'] : ['-3deg', '3deg'] }) : '0deg';
  const subjectScale = normalized === 'dolly_in'
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.3] })
    : normalized === 'dolly_out' ? progress.interpolate({ inputRange: [0, 1], outputRange: [1.3, 0.7] }) : 1;
  const revealOpacity = normalized === 'reveal'
    ? progress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.15, 0.45, 1] }) : 0.5;

  return (
    <View pointerEvents="none" style={styles.wrap} accessibilityLabel={`${label}: ${movementLabel || movement.replace(/_/g, ' ')}`}>
      {normalized === 'reveal' && (
        <Animated.View style={[styles.revealedScene, { opacity: revealOpacity }]}>
          <Ionicons name="sparkles-outline" size={24} color="#fff" />
        </Animated.View>
      )}
      <Animated.View style={[styles.deviceAndHand, { transform: [{ translateX }, { translateY }, { rotate }] }]}>
        <View style={styles.phone}>
          <View style={styles.screen}>
            <Animated.View style={{ transform: [{ scale: subjectScale }] }}>
              <Ionicons name={movementIcons[normalized] || 'hand-left-outline'} size={26} color="#fff" />
            </Animated.View>
            <View style={styles.cameraDot} />
          </View>
        </View>
        <View style={styles.hand}>
          <Ionicons name="hand-left-outline" size={36} color="#fff" />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', alignSelf: 'center', top: '37%', alignItems: 'center',
    opacity: 0.76, zIndex: 1, width: 190, height: 150,
  },
  revealedScene: { position: 'absolute', top: 38, left: 24 },
  deviceAndHand: { width: 68, height: 116 },
  phone: {
    width: 68, height: 116, padding: 5, borderRadius: 16, borderWidth: 2,
    borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.5)',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'rgba(255,255,255,0.12)' },
  cameraDot: { position: 'absolute', top: 6, width: 9, height: 3, borderRadius: 2, backgroundColor: '#fff' },
  hand: { position: 'absolute', bottom: -25, right: -24, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
});
