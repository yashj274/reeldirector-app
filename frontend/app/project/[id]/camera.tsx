import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';

import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { ClipVideoPreview } from '@/src/ClipVideoPreview';
import { MovementGuide } from '@/src/MovementGuide';
import { useT } from '@/src/i18n';

type Mode = 'video' | 'cinematic';
type RecordedVideo = { uri?: string; blob?: Blob; mimeType?: string };
type VideoFrame = { frameBase64: string; durationSeconds: number };

function readVideoFrame(file: File): Promise<VideoFrame> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    const cleanup = () => {
      video.onerror = null;
      video.onloadedmetadata = null;
      video.onseeked = null;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('The selected video could not be opened. Try recording it again.'));
    };
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        cleanup();
        reject(new Error('The selected video has no readable duration.'));
        return;
      }
      video.currentTime = Math.min(0.25, video.duration / 2);
    };
    video.onseeked = () => {
      try {
        const scale = Math.min(1, 1280 / video.videoWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not read a frame from the selected video.');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frameBase64 = canvas.toDataURL('image/jpeg', 0.4).split(',', 2)[1];
        const durationSeconds = video.duration;
        cleanup();
        resolve({ frameBase64, durationSeconds });
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    video.src = url;
    video.load();
  });
}

const MODES: { id: Mode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'video', label: 'Video', icon: 'videocam' },
  { id: 'cinematic', label: 'Stabilized', icon: 'film' },
];

export default function DirectorCamera() {
  const t = useT();
  const { id, shot } = useLocalSearchParams<{ id: string; shot?: string }>();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const recordingPromise = useRef<Promise<RecordedVideo | undefined> | null>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const webStreamRef = useRef<MediaStream | null>(null);
  const webAudioStreamRef = useRef<MediaStream | null>(null);
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<Blob[]>([]);
  const stoppingRecording = useRef(false);
  const directionPending = useRef(false);

  const [project, setProject] = useState<any>(null);
  const [shotIndex, setShotIndex] = useState<number>(shot ? parseInt(shot) : 0);
  const [instruction, setInstruction] = useState<{ text: string; arrow: string; ready: boolean } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [quality, setQuality] = useState<any>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [directionBusy, setDirectionBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [webStream, setWebStream] = useState<MediaStream | null>(null);

  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipStart = useRef<number>(0);

  const [mode, setMode] = useState<Mode>('video');
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [zoom, setZoom] = useState(0);
  const [grid, setGrid] = useState(true);
  const [brightness, setBrightness] = useState(0);

  useEffect(() => {
    if (!id) return;
    api.getProject(id).then(setProject).catch(() => {});
  }, [id]);

  const openWebCamera = useCallback(async (preferredFacing = facing) => {
    if (Platform.OS !== 'web') return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Live camera access is unavailable here. Use “Record or choose a video” to capture a clip with your phone or select one from your library.');
    }
    const nextStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: preferredFacing === 'back' ? 'environment' : 'user' },
        width: { ideal: 1280 }, height: { ideal: 720 },
      },
      audio: false,
    });
    const previousStream = webStreamRef.current;
    webStreamRef.current = nextStream;
    setWebStream(nextStream);
    setCameraReady(false);
    previousStream?.getTracks().forEach((track) => track.stop());
    setFlash('off');
    setCameraError(null);
  }, [facing]);

  const choosePhoneVideo = useCallback(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        setCameraError(null);
        setAnalyzing(true);
        try {
          const frame = await readVideoFrame(file);
          if (!id) throw new Error('The project could not be found. Go back and reopen it.');
          const mimeType = file.type || (file.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4');
          const result = await api.clipQuality(id, shotIndex, frame.frameBase64, frame.durationSeconds, {
            blob: file, mimeType,
          }, brightness);
          setQuality(result);
          setProject(await api.getProject(id));
        } catch (error: any) {
          console.warn('Phone video upload failed:', error);
          setCameraError(error?.message || 'Could not save this video. Check your connection and try again.');
        } finally {
          setAnalyzing(false);
        }
      })();
    };
    input.click();
  }, [id, shotIndex, brightness]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !webStream || !webVideoRef.current) return;
    const video = webVideoRef.current;
    let disposed = false;
    const markReady = () => {
      if (!disposed && video.videoWidth > 0 && video.videoHeight > 0) {
        setCameraReady(true);
        setCameraError(null);
      }
    };
    video.addEventListener('loadedmetadata', markReady);
    video.addEventListener('canplay', markReady);
    video.srcObject = webStream;
    void video.play().then(markReady).catch(() => {
      if (!disposed) setCameraError('The camera is open, but this browser blocked its preview. Tap Reopen camera or check camera access in browser settings.');
    });
    return () => {
      disposed = true;
      video.removeEventListener('loadedmetadata', markReady);
      video.removeEventListener('canplay', markReady);
      if (video.srcObject === webStream) video.srcObject = null;
    };
  }, [webStream]);

  useEffect(() => () => {
    const recorder = webRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    webStreamRef.current?.getTracks().forEach((track) => track.stop());
    webAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const shotObj = project?.storyboard?.[shotIndex];

  const captureFrame = useCallback(async () => {
    if (Platform.OS === 'web') {
      const video = webVideoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) {
        throw new Error('Wait for the camera preview to become ready, then try again.');
      }
      const scale = Math.min(1, 1280 / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not capture a frame from the camera.');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.4).split(',', 2)[1];
    }
    const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.4, skipProcessing: true });
    if (!photo?.base64) throw new Error('Could not capture a frame from the camera.');
    return photo.base64;
  }, []);

  // Ask the vision model to direct the current frame, not just the storyboard text.
  const requestDirection = useCallback(async () => {
    if (!id || !shotObj || !cameraReady || (Platform.OS !== 'web' && !cameraRef.current) || directionPending.current) return;
    directionPending.current = true;
    setDirectionBusy(true);
    try {
      const imageBase64 = await captureFrame();
      const r = await api.director(id, shotIndex, imageBase64);
      setInstruction({ text: r.instruction, arrow: r.arrow_direction, ready: r.ready });
      setCameraError(null);
    } catch (e: any) {
      setInstruction({ text: shotObj.direction?.slice(0, 40) || 'Hold steady', arrow: 'none', ready: false });
      if (e.message?.includes('not configured') || e.message?.includes('not connected')) setCameraError(e.message);
    } finally {
      directionPending.current = false;
      setDirectionBusy(false);
    }
  }, [id, shotIndex, shotObj, cameraReady, captureFrame]);

  useEffect(() => {
    setInstruction(null);
    if (cameraReady) requestDirection();
  }, [cameraReady, requestDirection]);

  const targetDur = shotObj?.duration_seconds || 3;

  useEffect(() => {
    const previous = (project?.clips || []).find((clip: any) => clip.shot_index === shotIndex);
    setBrightness(Math.max(-0.5, Math.min(0.5, Number(previous?.brightness) || 0)));
  }, [project?.clips, shotIndex]);

  const toggleFlash = async () => {
    if (flash === 'on') {
      if (Platform.OS === 'web') {
        const track = webStreamRef.current?.getVideoTracks()[0];
        try { await track?.applyConstraints({ advanced: [{ torch: false }] } as any); } catch { /* best effort */ }
      }
      setFlash('off');
      return;
    }
    if (Platform.OS === 'web') {
      const track = webStreamRef.current?.getVideoTracks()[0] as (MediaStreamTrack & { getCapabilities?: () => any }) | undefined;
      if (!track || (track as any).getCapabilities?.()?.torch !== true) {
        setCameraError(t('camera_movement_unavailable'));
        return;
      }
      try {
        await track.applyConstraints({ advanced: [{ torch: true }] } as any);
        setCameraError(null);
        setFlash('on');
      } catch {
        setCameraError(t('camera_movement_unavailable'));
      }
      return;
    }
    setFlash('on');
  };

  const startTimer = () => {
    clipStart.current = Date.now();
    setRecording(true);
    setRecSeconds(0);
    recTimer.current = setInterval(() => {
      const elapsed = (Date.now() - clipStart.current) / 1000;
      setRecSeconds(elapsed);
      if (elapsed >= targetDur) void stopRec();
    }, 100);
  };

  const startRec = async () => {
    if (recording) return;
    setCameraError(null);
    if (Platform.OS === 'web') {
      try {
        const cameraStream = webStreamRef.current;
        if (!cameraStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
          throw new Error('The camera is not ready. Reopen the live camera and try again.');
        }
        if (typeof MediaRecorder === 'undefined') {
          throw new Error('Video recording is not supported by this browser. Try a current version of Safari or Chrome.');
        }
        // Ask for microphone access only when recording. A microphone denial must
        // never prevent a user from seeing the camera preview.
        let audioTracks: MediaStreamTrack[] = [];
        try {
          webAudioStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          audioTracks = webAudioStreamRef.current.getAudioTracks();
        } catch {
          setCameraError('Microphone access is off. Recording will continue without sound.');
        }
        const recordingStream = new MediaStream([
          ...cameraStream.getVideoTracks(),
          ...audioTracks,
        ]);
        const supportedTypes = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4',
        ];
        const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported(type));
        const recorder = new MediaRecorder(recordingStream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 2_500_000,
          audioBitsPerSecond: 128_000,
        });
        webChunksRef.current = [];
        const completed = new Promise<RecordedVideo>((resolve, reject) => {
          recorder.ondataavailable = (event) => {
            if (event.data.size) webChunksRef.current.push(event.data);
          };
          recorder.onerror = (event) => reject((event as any).error || new Error('The browser could not record this clip.'));
          recorder.onstop = () => {
            const type = recorder.mimeType || mimeType || 'video/webm';
            const blob = new Blob(webChunksRef.current, { type });
            if (!blob.size) reject(new Error('The camera produced an empty video. Try recording again.'));
            else resolve({ blob, mimeType: type });
          };
        });
        webRecorderRef.current = recorder;
        recordingPromise.current = completed;
        recorder.start(250);
        startTimer();
      } catch (e: any) {
        recordingPromise.current = null;
        setCameraError(e.message || 'Could not start the camera recording.');
      }
      return;
    }
    let currentMicPermission = micPermission;
    if (!currentMicPermission?.granted) {
      currentMicPermission = await requestMicPermission();
    }
    if (!currentMicPermission.granted) {
      setCameraError('Microphone access is needed to record video with sound.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    try {
      const recordingOptions = Platform.OS === 'ios'
        ? { maxDuration: Math.max(1, Math.ceil(targetDur)), codec: 'avc1' as const }
        : { maxDuration: Math.max(1, Math.ceil(targetDur)) };
      const nextRecording = cameraRef.current?.recordAsync(recordingOptions);
      if (!nextRecording) throw new Error('Camera is not ready. Try again in a moment.');
      recordingPromise.current = nextRecording;
      startTimer();
    } catch (e: any) {
      recordingPromise.current = null;
      setCameraError(e.message || 'Could not start the camera recording.');
    }
  };

  const stopRec = async () => {
    if (stoppingRecording.current || !recordingPromise.current) return;
    stoppingRecording.current = true;
    if (recTimer.current) { clearInterval(recTimer.current); recTimer.current = null; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setAnalyzing(true);
    try {
      if (Platform.OS === 'web') {
        const recorder = webRecorderRef.current;
        if (!recorder || recorder.state === 'inactive') throw new Error('The browser recording is not active. Try again.');
        recorder.stop();
      } else {
        cameraRef.current?.stopRecording();
      }
      const recorded = await recordingPromise.current;
      if (!recorded?.uri && !recorded?.blob) throw new Error('The camera did not return a video file.');
      const dur = Math.max(0.1, (Date.now() - clipStart.current) / 1000);
      const frameBase64 = await captureFrame();
      if (id) {
        const q = await api.clipQuality(id, shotIndex, frameBase64, dur, {
          uri: recorded.uri, blob: recorded.blob, mimeType: recorded.mimeType,
        }, brightness);
        setQuality(q);
        setProject(await api.getProject(id));
      }
    } catch (e) {
      console.warn('Recording or upload failed:', e);
      setCameraError(e instanceof Error ? e.message : 'Could not save this clip. Please try again.');
    } finally {
      recordingPromise.current = null;
      webRecorderRef.current = null;
      webAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
      webAudioStreamRef.current = null;
      stoppingRecording.current = false;
      setRecording(false);
      setAnalyzing(false);
    }
  };

  const nextShot = async () => {
    setQuality(null);
    const total = project?.storyboard?.length || 0;
    if (shotIndex + 1 < total) {
      setShotIndex(shotIndex + 1);
    } else {
      // done - go to review or export
      const fresh = await api.getProject(id!);
      setProject(fresh);
      router.replace({ pathname: '/project/[id]/export', params: { id: id! } });
    }
  };

  const retake = async () => {
    if (id) {
      try {
        await api.retakeShot(id, shotIndex);
        setProject(await api.getProject(id));
      } catch (e: any) { setCameraError(e.message || 'Could not remove the previous take.'); }
    }
    setQuality(null);
  };

  if (Platform.OS !== 'web' && !permission) {
    return (
      <View style={[styles.root, styles.center]} testID="camera-permission-loading">
        <ActivityIndicator color={theme.color.brand} />
        <Text style={styles.permSub}>Starting camera…</Text>
      </View>
    );
  }
  const needsPermission = Platform.OS === 'web'
    ? !webStream && !quality
    : !permission?.granted;
  const webCameraNeedsHttps = Platform.OS === 'web'
    && typeof window !== 'undefined' && !window.isSecureContext;
  if (needsPermission) {
    return (
      <View style={[styles.root, styles.center]} testID="camera-permission-screen">
        <Ionicons name="videocam-outline" size={48} color={theme.color.onSurface2} />
        <Text style={styles.permTitle}>{Platform.OS === 'web' ? t('camera_mic_title') : 'Camera access needed'}</Text>
        <Text style={styles.permSub}>{webCameraNeedsHttps
          ? t('camera_https_copy')
          : Platform.OS === 'web'
            ? 'Allow camera access to frame your shot. Microphone access is requested only when you start recording.'
            : 'Allow camera access to frame and record your shot. Microphone access is requested when recording starts.'}</Text>
        {cameraError && <Text style={styles.cameraError}>{cameraError}</Text>}
        {analyzing && <ActivityIndicator color={theme.color.brand} />}
        <Pressable style={[styles.permBtn, analyzing && { opacity: 0.5 }]} disabled={analyzing} onPress={async () => {
          if (Platform.OS === 'web') {
            if (webCameraNeedsHttps) {
              choosePhoneVideo();
              return;
            }
            try { await openWebCamera(facing); }
            catch (e: any) { setCameraError(e.message || 'Could not open the camera. Check browser camera permission and try again.'); }
            return;
          }
          if (!permission?.granted) await requestPermission();
        }} testID="camera-grant-permission">
          <Text style={styles.permBtnText}>{Platform.OS !== 'web'
            ? t('grant_access') : webCameraNeedsHttps ? t('record_or_choose_video') : t('open_live_camera')}</Text>
        </Pressable>
        {Platform.OS === 'web' && !webCameraNeedsHttps && (
          <Pressable style={[styles.permBtn, styles.permBtnSecondary, analyzing && { opacity: 0.5 }]}
            disabled={analyzing} onPress={choosePhoneVideo} testID="camera-choose-phone-video">
            <Text style={styles.permBtnText}>{t('record_or_choose_video')}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const arrowIcon = (a: string) => {
    switch (a) {
      case 'up': return 'arrow-up';
      case 'down': return 'arrow-down';
      case 'left': return 'arrow-back';
      case 'right': return 'arrow-forward';
      case 'forward': return 'arrow-up-circle';
      case 'back': return 'arrow-down-circle';
      case 'rotate_cw':
      case 'rotate_ccw': return 'refresh';
      default: return 'checkmark-circle';
    }
  };

  return (
    <View style={styles.root} testID="director-camera-screen">
      {Platform.OS === 'web'
        ? webStream ? createElement('video' as any, {
          ref: (element: HTMLVideoElement | null) => { webVideoRef.current = element; },
          autoPlay: true,
          muted: true,
          playsInline: true,
          'aria-label': t('live_camera'),
          style: {
            position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
            display: 'block', backgroundColor: '#111',
            transform: facing === 'front' ? 'scaleX(-1)' : undefined,
            filter: `brightness(${Math.max(0.5, Math.min(1.5, 1 + brightness))})`,
          },
        }) : (
          <View style={[StyleSheet.absoluteFill, styles.videoFilePreview]}>
            <Ionicons name="videocam-outline" size={44} color={theme.color.onSurface2} />
            <Text style={styles.videoFilePreviewText}>{t('phone_camera_clip_ready')}</Text>
          </View>
        )
        : <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          mode="video"
          mute={false}
          videoQuality="1080p"
          videoStabilizationMode={mode === 'cinematic' ? 'cinematic' : 'standard'}
          onCameraReady={() => setCameraReady(true)}
          facing={facing}
          flash={flash}
          zoom={zoom}
          enableTorch={flash === 'on' && facing === 'back'}
        />}
      {!quality && !cameraReady && (Platform.OS !== 'web' || !!webStream) && (
        <View style={styles.cameraLoadingOverlay} testID="camera-preview-loading">
          <ActivityIndicator size="large" color={theme.color.brand} />
          <Text style={styles.cameraLoadingText}>{cameraError || 'Connecting to camera preview…'}</Text>
          {Platform.OS === 'web' && !!webStream && (
            <Pressable
              style={styles.reopenCameraButton}
              onPress={() => { void openWebCamera(facing).catch((error: any) => setCameraError(error.message || 'Could not reopen the camera.')); }}
              testID="camera-reopen-preview"
            >
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.reopenCameraText}>Reopen camera</Text>
            </Pressable>
          )}
        </View>
      )}
      {Platform.OS !== 'web' && brightness !== 0 && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: brightness > 0 ? '#fff' : '#000', opacity: Math.min(0.5, Math.abs(brightness)) }]} />
      )}
      {grid && (
        <>
          <View style={styles.gridV} pointerEvents="none" />
          <View style={styles.gridV2} pointerEvents="none" />
          <View style={styles.gridH} pointerEvents="none" />
          <View style={styles.gridH2} pointerEvents="none" />
        </>
      )}
      <SafeAreaView style={{ flex: 1 }}>
        {/* Top: shot info */}
        <View style={styles.topRow}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()} testID="camera-back">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <View style={styles.shotPill}>
            <BlurView tint="dark" intensity={50} style={StyleSheet.absoluteFill} />
            <Text style={styles.shotPillLabel}>{t('shot_counter').replace('{current}', String(shotIndex + 1)).replace('{total}', String(project?.storyboard?.length || '-'))}</Text>
            <Text style={styles.shotPillTitle} numberOfLines={1}>{shotObj?.title || ''}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* AI instruction */}
        {!quality && (
          <View style={styles.instrWrap}>
            <BlurView tint="dark" intensity={50} style={StyleSheet.absoluteFill} />
            {directionBusy ? <ActivityIndicator color={theme.color.brand} /> : (
              <Ionicons name={arrowIcon(instruction?.arrow || 'none') as any} size={26} color={theme.color.brand} />
            )}
            <Text style={styles.instrText} numberOfLines={2}>{instruction?.text || shotObj?.direction || 'Preparing shot direction…'}</Text>
            <Pressable onPress={requestDirection} disabled={directionBusy || recording} testID="camera-refresh-direction">
              <Ionicons name="refresh" size={20} color={directionBusy ? theme.color.onSurface3 : '#fff'} />
            </Pressable>
          </View>
        )}

        {!quality && !!shotObj?.camera_movement && <MovementGuide movement={shotObj.camera_movement} label={t('move_guide')} movementLabel={t(`move_${String(shotObj.camera_movement).toLowerCase().replace(/\s+/g, '_')}`)} />}

        {/* Right-side quick controls */}
        {!quality && !recording && (
          <View style={styles.sideCol}>
            <IconChip label={t('grid')} on={grid} icon="grid-outline" onPress={() => setGrid((v) => !v)} testID="cam-grid" />
            <IconChip icon={flash === 'on' ? 'flash' : 'flash-off'} on={flash !== 'off'}
              label={t('flashlight')} onPress={() => void toggleFlash()} testID="cam-flash" />
            <IconChip icon={facing === 'back' ? 'camera-reverse-outline' : 'camera-reverse'} label={t('flip_camera')} on={false}
              onPress={() => {
                const nextFacing = facing === 'back' ? 'front' : 'back';
                setFacing(nextFacing);
                setFlash('off');
                if (Platform.OS === 'web') void openWebCamera(nextFacing).catch((e: any) => setCameraError(e.message));
              }} testID="cam-flip" />
          </View>
        )}

        {/* Zoom slider */}
        {!quality && !recording && Platform.OS !== 'web' && (
          <View style={styles.zoomBar} pointerEvents="box-none">
            {[0, 0.2, 0.45, 0.8].map((z, index) => (
              <Pressable key={z} onPress={() => setZoom(z)} style={[styles.zoomChip, zoom === z && styles.zoomChipOn]} testID={`cam-zoom-${z}`}>
                <Text style={[styles.zoomText, zoom === z && { color: theme.color.brand }]}>{['1x', 'Low', 'Mid', 'High'][index]}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ flex: 1 }} />

        {/* Quality result sheet */}
        {quality ? (
          <View style={styles.qualityWrap}>
            <BlurView tint="dark" intensity={70} style={StyleSheet.absoluteFill} />
            <View style={{ padding: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {quality.review_available === false ? (
                  <Ionicons name="eye-outline" size={30} color={theme.color.warning} />
                ) : (
                  <View style={[styles.qBadge, { backgroundColor: quality.recommendation === 'retake_required' ? theme.color.error : quality.recommendation === 'retake_optional' ? theme.color.warning : theme.color.success }]}>
                    <Text style={styles.qBadgeText}>{Math.round(quality.overall_score)}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.qTitle}>{quality.review_available === false ? t('clip_saved') : quality.recommendation === 'keep' ? t('great_shot') : quality.recommendation === 'retake_optional' ? t('retake_suggested') : t('retake_required')}</Text>
                  <Text style={styles.qReason} numberOfLines={2}>{quality.review_available === false ? t('rating_unavailable') : quality.reason}</Text>
                </View>
              </View>

              {quality.review_available !== false && <View style={styles.qGrid}>
                <QSlot label={t('blur')} v={quality.blur_score} />
                <QSlot label={t('exposure')} v={quality.exposure_score} />
                <QSlot label={t('framing')} v={quality.composition_score} />
                <QSlot label={t('stability')} v={quality.stability_score} />
              </View>}
              {!!quality.issues?.length && quality.review_available !== false && (
                <View style={styles.issuesList}>
                  {quality.issues.slice(0, 3).map((issue: string, index: number) => <Text key={`${index}-${issue}`} style={styles.qIssue}>• {issue}</Text>)}
                </View>
              )}

              {(() => {
                const reviewedClip = (project?.clips || []).find((clip: any) => clip.shot_index === shotIndex);
                return reviewedClip ? (
                  <View style={styles.recordedPreview}>
                    <Text style={styles.previewLabel}>{t('your_shot')}</Text>
                    <ClipVideoPreview uri={reviewedClip.video_url} posterUri={reviewedClip.frame_url} height={200} brightness={reviewedClip.brightness || 0} />
                    <Pressable
                      style={styles.editClipLink}
                      onPress={() => router.push({ pathname: '/project/[id]/export', params: { id: id!, clip: String(shotIndex) } })}
                      testID="camera-edit-clip"
                    >
                      <Ionicons name="options-outline" size={16} color="#fff" />
                    <Text style={styles.editClipText}>{t('edit_filters_text_trim')}</Text>
                    </Pressable>
                  </View>
                ) : null;
              })()}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <Pressable style={styles.ghost} onPress={retake} testID="camera-retake">
                  <Text style={styles.ghostText}>{t('retake')}</Text>
                </Pressable>
                <Pressable style={styles.primary} onPress={nextShot} testID="camera-next">
                  <Text style={styles.primaryText}>{shotIndex + 1 < (project?.storyboard?.length || 0) ? t('next_shot') : t('finish_edit')}</Text>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.recWrap}>
            {analyzing ? (
              <View style={styles.analyzing}>
                <BlurView tint="dark" intensity={50} style={StyleSheet.absoluteFill} />
                <ActivityIndicator color={theme.color.brand} />
                <Text style={styles.analyzingText}>{t('checking_clip_frame')}</Text>
              </View>
            ) : (
              <>
                {/* Mode selector */}
                <View style={styles.brightnessRow}>
                  <Ionicons name="sunny-outline" size={17} color="#fff" />
                  <Text style={styles.brightnessLabel}>{t('brightness')}</Text>
                  <Pressable accessibilityLabel="Decrease brightness" onPress={() => setBrightness((v) => Math.max(-0.5, Math.round((v - 0.05) * 100) / 100))} style={styles.brightnessButton} testID="cam-brightness-down">
                    <Ionicons name="remove" size={17} color="#fff" />
                  </Pressable>
                  <Text style={styles.brightnessValue}>{Math.round(brightness * 100)}%</Text>
                  <Pressable accessibilityLabel="Increase brightness" onPress={() => setBrightness((v) => Math.min(0.5, Math.round((v + 0.05) * 100) / 100))} style={styles.brightnessButton} testID="cam-brightness-up">
                    <Ionicons name="add" size={17} color="#fff" />
                  </Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }} style={{ maxHeight: 40 }}>
                  {MODES.filter((m) => Platform.OS !== 'web' || m.id === 'video').map((m) => (
                    <Pressable key={m.id} onPress={() => setMode(m.id)} style={[styles.modeChip, mode === m.id && styles.modeChipOn]} testID={`cam-mode-${m.id}`}>
                      <Ionicons name={m.icon} size={13} color={mode === m.id ? theme.color.brand : '#fff'} />
                      <Text style={[styles.modeText, mode === m.id && { color: theme.color.brand }]}>{t(m.id === 'video' ? 'video_mode' : 'stabilized_mode')}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <Text style={styles.timer}>{recording ? `${recSeconds.toFixed(1)}s / ${targetDur.toFixed(1)}s` : `${t(mode === 'video' ? 'video_mode' : 'stabilized_mode')}  ·  ${targetDur.toFixed(1)}s`}</Text>
                {cameraError && <Text style={styles.cameraError}>{cameraError}</Text>}
                <Pressable
                  onPress={recording ? stopRec : startRec}
                  style={styles.recBtnOuter}
                  testID="camera-record-button"
                >
                  <View style={[styles.recBtnInner, recording && styles.recBtnInnerActive]} />
                </Pressable>
                <View style={styles.progressBar}>
                  <View style={[styles.progressBarFill, { width: `${Math.min(100, (recSeconds / targetDur) * 100)}%` }]} />
                </View>
              </>
            )}
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function QSlot({ label, v }: { label: string; v: number }) {
  const val = Math.max(0, Math.min(100, v || 0));
  return (
    <View style={{ flex: 1, minWidth: '45%' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.qLabel}>{label}</Text>
        <Text style={styles.qVal}>{Math.round(val)}</Text>
      </View>
      <View style={styles.qTrack}><View style={[styles.qFill, { width: `${val}%` }]} /></View>
    </View>
  );
}

function IconChip({ icon, on, onPress, testID, label }: { icon: keyof typeof Ionicons.glyphMap; on: boolean; onPress: () => void; testID: string; label?: string }) {
  return (
    <Pressable style={[styles.iconChip, on && styles.iconChipOn]} onPress={onPress} testID={testID} accessibilityLabel={label}>
      <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
      <Ionicons name={icon} size={18} color={on ? theme.color.brand : '#fff'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  permTitle: { color: theme.color.onSurface, fontSize: 20, fontWeight: '700', marginTop: 12 },
  permSub: { color: theme.color.onSurface2, textAlign: 'center', marginTop: 4 },
  permBtn: { marginTop: 12, backgroundColor: theme.color.brand, paddingHorizontal: 20, height: 48, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  permBtnText: { color: '#fff', fontWeight: '700' },
  permBtnSecondary: { backgroundColor: theme.color.surface3, borderWidth: 1, borderColor: theme.color.border },
  videoFilePreview: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface2, gap: 12 },
  videoFilePreviewText: { color: theme.color.onSurface2, fontSize: 15, fontWeight: '600' },
  cameraLoadingOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12, backgroundColor: 'rgba(0,0,0,0.48)' },
  cameraLoadingText: { color: '#fff', textAlign: 'center', fontSize: 14, fontWeight: '600' },
  reopenCameraButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14, borderRadius: theme.radius.md, backgroundColor: theme.color.brand },
  reopenCameraText: { color: '#fff', fontWeight: '700' },
  gridV: { position: 'absolute', top: 0, bottom: 0, left: '33%', width: 0.5, backgroundColor: 'rgba(255,255,255,0.18)' },
  gridV2: { position: 'absolute', top: 0, bottom: 0, left: '66%', width: 0.5, backgroundColor: 'rgba(255,255,255,0.18)' },
  gridH: { position: 'absolute', left: 0, right: 0, top: '33%', height: 0.5, backgroundColor: 'rgba(255,255,255,0.18)' },
  gridH2: { position: 'absolute', left: 0, right: 0, top: '66%', height: 0.5, backgroundColor: 'rgba(255,255,255,0.18)' },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  shotPill: { flex: 1, height: 52, borderRadius: theme.radius.md, overflow: 'hidden', paddingHorizontal: 14, justifyContent: 'center' },
  shotPillLabel: { color: theme.color.brand, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  shotPillTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 2 },
  instrWrap: { marginHorizontal: 16, marginTop: 14, minHeight: 56, borderRadius: theme.radius.md, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  instrText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700' },
  recWrap: { padding: 20, alignItems: 'center', gap: 12 },
  timer: { color: '#fff', fontSize: 13, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill },
  recBtnOuter: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recBtnInner: { width: 66, height: 66, borderRadius: 33, backgroundColor: theme.color.brand },
  recBtnInnerActive: { width: 30, height: 30, borderRadius: 6 },
  progressBar: { width: '80%', height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: theme.color.brand },
  analyzing: { minHeight: 100, borderRadius: theme.radius.lg, overflow: 'hidden', margin: 16, padding: 24, flexDirection: 'row', alignItems: 'center', gap: 14 },
  analyzingText: { color: '#fff', fontWeight: '700' },
  cameraError: { color: '#fff', backgroundColor: 'rgba(180,30,60,0.85)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.md, textAlign: 'center', maxWidth: '90%' },
  qualityWrap: { margin: 16, borderRadius: theme.radius.lg, overflow: 'hidden' },
  qBadge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  qBadgeText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  qTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  qReason: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2 },
  issuesList: { marginTop: 8, gap: 3 },
  qIssue: { color: 'rgba(255,255,255,0.84)', fontSize: 12 },
  qGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  qLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600' },
  qVal: { color: '#fff', fontSize: 11, fontWeight: '700' },
  qTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 5, overflow: 'hidden' },
  qFill: { height: '100%', backgroundColor: theme.color.brand },
  recordedPreview: { marginTop: 16, gap: 8 },
  previewLabel: { color: '#fff', fontSize: 12, fontWeight: '700' },
  editClipLink: { minHeight: 40, borderRadius: theme.radius.md, backgroundColor: 'rgba(224,17,95,0.88)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  editClipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  ghost: { flex: 1, height: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: '#fff', fontWeight: '700' },
  primary: { flex: 1.4, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#fff', fontWeight: '700' },
  sideCol: { position: 'absolute', right: 12, top: 120, gap: 10 },
  iconChip: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  iconChipOn: { borderWidth: 1, borderColor: theme.color.brand },
  zoomBar: { position: 'absolute', bottom: 220, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  zoomChip: { paddingHorizontal: 12, height: 32, borderRadius: theme.radius.pill, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  zoomChipOn: { backgroundColor: theme.color.brandTint, borderWidth: 1, borderColor: theme.color.brand },
  zoomText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  brightnessRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 12, borderRadius: theme.radius.pill, backgroundColor: 'rgba(0,0,0,0.58)' },
  brightnessLabel: { color: '#fff', fontSize: 12, fontWeight: '700', marginRight: 4 },
  brightnessButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  brightnessValue: { color: '#fff', minWidth: 36, textAlign: 'center', fontSize: 12, fontWeight: '700' },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 32, borderRadius: theme.radius.pill, backgroundColor: 'rgba(0,0,0,0.55)', flexShrink: 0 },
  modeChipOn: { backgroundColor: theme.color.brandTint, borderWidth: 1, borderColor: theme.color.brand },
  modeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
