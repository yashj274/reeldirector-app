import { useVideoPlayer, VideoView } from 'expo-video';
import { Image } from 'expo-image';
import { Platform, StyleSheet, Text, View } from 'react-native';

type Props = {
  uri?: string | null;
  posterUri?: string | null;
  height?: number;
  filter?: string;
  look?: string;
  title?: string;
  titleFont?: string;
  titlePosition?: string;
  titleColor?: string;
  titleSize?: string;
};

const cssFilters: Record<string, string> = {
  warm: 'sepia(0.16) saturate(1.12)',
  cool: 'hue-rotate(9deg) saturate(1.06)',
  mono: 'grayscale(1) contrast(1.04)',
  vivid: 'saturate(1.22) contrast(1.08)',
  vintage: 'sepia(0.24) saturate(0.8) contrast(0.92)',
  soft: 'saturate(0.92) contrast(0.92)',
  cinematic: 'contrast(1.08) saturate(0.9)',
  luxury: 'contrast(1.08) saturate(0.94)',
  editorial: 'contrast(1.06) saturate(0.86)',
  action: 'contrast(1.12) saturate(1.12)',
  fast_pace: 'contrast(1.08) saturate(1.12)',
  minimal: 'saturate(0.85)',
};

const nativeTint: Record<string, string> = {
  warm: 'rgba(233, 139, 65, 0.12)',
  cool: 'rgba(62, 129, 220, 0.12)',
  vintage: 'rgba(185, 139, 78, 0.14)',
  soft: 'rgba(255, 255, 255, 0.08)',
  luxury: 'rgba(38, 24, 13, 0.12)',
};

const titleColors: Record<string, string> = {
  white: '#fff', gold: '#F5C869', pink: '#E0115F', black: '#101114',
};

export function ClipVideoPreview({
  uri, posterUri, height = 190, filter = 'original', look = 'original', title,
  titleFont = 'sans', titlePosition = 'bottom', titleColor = 'white', titleSize = 'medium',
}: Props) {
  const player = useVideoPlayer(uri || null, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
  });
  const activePresets = [filter !== 'original' ? filter : null, look !== 'original' ? look : null].filter(Boolean) as string[];
  const effectiveFilter = activePresets.map((preset) => preset.replace('_', ' ')).join(' · ');
  const webFilter = activePresets.map((preset) => cssFilters[preset]).filter(Boolean).join(' ');
  const tint = nativeTint[filter !== 'original' ? filter : look];
  const fontFamily = titleFont === 'serif' ? 'Georgia' : titleFont === 'mono' ? 'Courier New' : undefined;
  const fontSize = titleSize === 'large' ? 22 : titleSize === 'small' ? 14 : 18;

  return (
    <View style={[styles.frame, { height }]}>
      {uri ? (
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, Platform.OS === 'web' && webFilter ? ({ filter: webFilter } as any) : null]}
          contentFit="cover"
          nativeControls
        />
      ) : posterUri ? (
        <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={styles.empty}><Text style={styles.emptyText}>Clip preview unavailable</Text></View>
      )}
      {Platform.OS !== 'web' && tint ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} /> : null}
      {!!title && (
        <View pointerEvents="none" style={[styles.titleWrap, titlePosition === 'top' ? styles.titleTop : titlePosition === 'center' ? styles.titleCenter : styles.titleBottom]}>
          <Text
            numberOfLines={2}
            style={[
              styles.title,
              { color: titleColors[titleColor] || '#fff', fontFamily, fontSize },
              titleColor === 'black' ? styles.darkTitle : null,
            ]}
          >
            {title}
          </Text>
        </View>
      )}
      {effectiveFilter !== 'original' && (
        <View pointerEvents="none" style={styles.filterBadge}>
          <Text style={styles.filterBadgeText}>{effectiveFilter.replace('_', ' ')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: '#08090c' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.66)', fontSize: 13 },
  filterBadge: { position: 'absolute', top: 9, left: 9, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.58)' },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  titleWrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  titleTop: { top: '14%' },
  titleCenter: { top: '43%' },
  titleBottom: { bottom: '14%' },
  title: { maxWidth: '94%', overflow: 'hidden', textAlign: 'center', fontWeight: '800', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, color: '#fff', backgroundColor: 'rgba(0,0,0,0.35)', textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  darkTitle: { backgroundColor: 'rgba(255,255,255,0.78)', textShadowColor: 'transparent' },
});
