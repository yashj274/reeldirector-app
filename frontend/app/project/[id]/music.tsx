import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAudioPlayer } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { useT } from '@/src/i18n';

export default function MusicPicker() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const player = useAudioPlayer(null);
  const [project, setProject] = useState<any>(null);
  const [pickedFile, setPickedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [removeTrack, setRemoveTrack] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) api.getProject(id).then(setProject).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    const url = pickedFile?.uri || project?.soundtrack?.signed_url;
    if (!url) {
      player.pause();
      setPreviewing(false);
      return;
    }
    player.replace({ uri: url });
    setPreviewing(false);
  }, [pickedFile?.uri, project?.soundtrack?.signed_url, player]);

  const chooseTrack = async () => {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*', copyToCacheDirectory: true, multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > 25 * 1024 * 1024) {
        setError('Choose an audio file under 25 MB.');
        return;
      }
      setPickedFile(asset);
      setRemoveTrack(false);
    } catch (e: any) {
      setError(e.message || 'Could not open your audio files.');
    }
  };

  const togglePreview = () => {
    if (previewing) {
      player.pause();
      setPreviewing(false);
    } else {
      player.play();
      setPreviewing(true);
    }
  };

  const apply = async () => {
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      if (pickedFile) {
        const saved = await api.saveSoundtrack(id, {
          uri: pickedFile.uri,
          name: pickedFile.name,
          mimeType: pickedFile.mimeType || undefined,
          file: pickedFile.file || undefined,
        });
        setProject((p: any) => ({ ...p, soundtrack: saved }));
      } else if (removeTrack) {
        await api.removeSoundtrack(id);
      }
      player.pause();
      const result = await api.export(id);
      router.replace({ pathname: '/project/[id]/final', params: { id, render: '1' } });
      return result;
    } catch (e: any) {
      setError(e.message || 'Could not apply the soundtrack and render your reel.');
    } finally {
      setBusy(false);
    }
  };

  const trackName = removeTrack ? '' : pickedFile?.name || project?.soundtrack?.title || '';

  return (
    <View style={styles.root} testID="music-picker-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="music-back">
            <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title}>{t('soundtrack')}</Text>
          <View style={{ width: 26 }} />
        </View>

        <View style={styles.content}>
          <View style={styles.card}>
            <View style={styles.musicIcon}>
              <Ionicons name="musical-notes" size={25} color={theme.color.brand} />
            </View>
            <Text style={styles.heading}>{trackName || t('use_your_audio')}</Text>
            <Text style={styles.subheading}>
              {trackName ? t('current_music_mix') : t('import_audio_mix')}
            </Text>
            {trackName ? (
              <View style={styles.trackActions}>
                <Pressable style={styles.outlineButton} onPress={togglePreview} testID="music-preview">
                  <Ionicons name={previewing ? 'pause' : 'play'} size={17} color={theme.color.onSurface} />
                  <Text style={styles.outlineText}>{previewing ? t('pause_preview') : t('preview')}</Text>
                </Pressable>
                <Pressable style={styles.outlineButton} onPress={() => { setPickedFile(null); setRemoveTrack(true); }} testID="music-remove">
                  <Ionicons name="trash-outline" size={17} color={theme.color.error} />
                  <Text style={[styles.outlineText, { color: theme.color.error }]}>{t('remove')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <Pressable style={styles.chooseButton} onPress={chooseTrack} testID="music-choose-file">
            <Ionicons name="folder-open-outline" size={20} color={theme.color.brand} />
            <Text style={styles.chooseText}>{trackName ? t('choose_different_audio') : t('choose_audio_file')}</Text>
          </Pressable>

          <Text style={styles.note}>{t('audio_file_note')}</Text>
          {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        </View>

        <View style={styles.footer}>
          <Pressable
            style={[styles.primary, busy && { opacity: 0.65 }]}
            onPress={apply}
            disabled={busy || !project}
            testID="music-apply"
          >
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={styles.primaryText}>{t('apply_render_video')}</Text>
              </>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { flex: 1, textAlign: 'center', color: theme.color.onSurface, fontSize: 17, fontWeight: '700' },
  content: { padding: 20 },
  card: { alignItems: 'center', padding: 24, borderRadius: theme.radius.lg, backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border },
  musicIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.color.brandTint, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heading: { color: theme.color.onSurface, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  subheading: { color: theme.color.onSurface2, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  trackActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  outlineButton: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: theme.radius.pill, paddingHorizontal: 14, height: 38, borderWidth: 1, borderColor: theme.color.border },
  outlineText: { color: theme.color.onSurface, fontSize: 13, fontWeight: '600' },
  chooseButton: { height: 54, borderRadius: theme.radius.md, marginTop: 16, backgroundColor: theme.color.brandTint, borderWidth: 1, borderColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  chooseText: { color: theme.color.brand, fontWeight: '700', fontSize: 15 },
  note: { color: theme.color.onSurface3, lineHeight: 18, fontSize: 12, marginTop: 12, textAlign: 'center' },
  error: { color: theme.color.error, marginTop: 16, textAlign: 'center' },
  footer: { position: 'absolute', left: 20, right: 20, bottom: 24 },
  primary: { height: 56, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
