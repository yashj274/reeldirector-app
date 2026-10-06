import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View,
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
type ZoomOption = { label: string; factor: number; value?: number; cameraZoom?: number; lens?: string; digitalOnly?: boolean };

const WEB_DIGITAL_ZOOM_OPTIONS: ZoomOption[] = [1, 1.5, 2, 3].map((factor) => ({
  label: `${factor}x`, factor, digitalOnly: true,
}));

const ANDROID_ZOOM_OPTIONS: ZoomOption[] = [
  { label: '1x', factor: 1, cameraZoom: 0 },
  { label: '2x', factor: 2, cameraZoom: 0.25 },
  { label: '3x', factor: 3, cameraZoom: 0.5 },
];

function getWebZoomOptions(track: MediaStreamTrack): ZoomOption[] {
  try {
    const getCapabilities = (track as MediaStreamTrack & { getCapabilities?: () => any }).getCapabilities;
    const range = getCapabilities?.call(track)?.zoom;
    const min = Number(range?.min);
    const max = Number(range?.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      return WEB_DIGITAL_ZOOM_OPTIONS;
    }
    const base = min <= 1 && max >= 1 ? 1 : min;
    return [0.5, 1, 1.5, 2, 3, 4]
      .map((factor) => ({ factor, value: factor === 1 ? base : base * factor }))
      .filter(({ value }) => value >= min && value <= max)
      .map(({ factor, value }) => ({ label: `${factor}x`, factor, value }));
  } catch {
    return WEB_DIGITAL_ZOOM_OPTIONS;
  }
}

function getIosLensZoomOptions(lenses: string[]): ZoomOption[] {
  const options = lenses.flatMap((lens) => {
    const name = lens.toLowerCase().replace(/[_-]/g, ' ');
    if (name.includes('ultra wide') || name.includes('ultrawide')) return [{ label: '0.5x', factor: 0.5, lens }];
    if (name.includes('wide')) return [{ label: '1x', factor: 1, lens }];
    if (name.includes('tele')) return [{ label: 'Tele', factor: 2, lens }];
    return [];
  });
  return options.sort((a, b) => a.factor - b.factor);
}

function drawCameraFrame(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number, zoomFactor: number) {
  const factor = Math.max(1, zoomFactor);
  const sourceWidth = video.videoWidth / factor;
  const sourceHeight = video.videoHeight / factor;
  context.drawImage(video, (video.videoWidth - sourceWidth) / 2, (video.videoHeight - sourceHeight) / 2,
    sourceWidth, sourceHeight, 0, 0, width, height);
}

function movementArrow(movement?: string): string {
  switch (String(movement || 'static').toLowerCase().trim().replace(/[\s-]+/g, '_')) {
    case 'pan_left': return 'left';
    case 'pan_right': case 'tracking': case 'reveal': return 'right';
    case 'tilt_up': return 'up';
    case 'tilt_down': return 'down';
    case 'dolly_in': return 'forward';
    case 'dolly_out': return 'back';
    case 'orbit': return 'rotate_cw';
    default: return 'none';
  }
}

function compactInstruction(shot: any, fallback: string) {
  const text = String(shot?.instruction || shot?.direction || '').split(/[.!?]/, 1)[0].trim();
  return text ? text.split(/\s+/).slice(0, 12).join(' ') : fallback;
}

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
  const webDigitalZoomStreamRef = useRef<MediaStream | null>(null);
  const webDigitalZoomFrameRef = useRef<number | null>(null);
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<Blob[]>([]);
  const stoppingRecording = useRef(false);
  const directionPending = useRef(false);
  const nativeLensFacing = useRef<'back' | 'front' | null>(null);

  const [project, setProject] = useState<any>(null);
  const [shotIndex, setShotIndex] = useState<number>(shot ? parseInt(shot) : 0);
  const shotIndexRef = useRef(shot ? parseInt(shot) : 0);
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
  const [webZoomOptions, setWebZoomOptions] = useState<ZoomOption[]>([]);
  const [nativeZoomOptions, setNativeZoomOptions] = useState<ZoomOption[]>(Platform.OS === 'ios' ? [] : ANDROID_ZOOM_OPTIONS);
  const [selectedLens, setSelectedLens] = useState<string | undefined>();
  const [selectedZoomLabel, setSelectedZoomLabel] = useState('1x');
  const [webDigitalZoom, setWebDigitalZoom] = useState(1);
  const [webDigitalZoomActive, setWebDigitalZoomActive] = useState(false);
  const [grid, setGrid] = useState(true);
  const [brightness, setBrightness] = useState(0);
  const [brightnessOpen, setBrightnessOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getProject(id).then((loaded) => {
      setProject(loaded);
      const requested = Math.max(0, Number.parseInt(shot || '0', 10) || 0);
      const existing = (loaded.clips || []).some((clip: any) => Number(clip.shot_index) === requested);
      const requestedShot = loaded.storyboard?.[requested];
      const requestedSkipped = requestedShot?.status === 'skipped';
      const firstUnfilmed = (loaded.storyboard || []).findIndex((item: any, index: number) =>
        item.status !== 'skipped' && (!(loaded.clips || []).some((clip: any) => Number(clip.shot_index) === index) || item.status === 'retake'));
      const selected = (existing || requestedSkipped) && firstUnfilmed >= 0 ? firstUnfilmed : requested;
      shotIndexRef.current = selected;
      setShotIndex(selected);
    }).catch(() => {});
  }, [id, shot]);

  useEffect(() => { shotIndexRef.current = shotIndex; }, [shotIndex]);

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
    const videoTrack = nextStream.getVideoTracks()[0];
    const options = videoTrack ? getWebZoomOptions(videoTrack) : [];
    setWebZoomOptions(options);
    setSelectedZoomLabel('1x');
    setWebDigitalZoom(1);
    setWebDigitalZoomActive(!!options[0]?.digitalOnly);
    const previousStream = webStreamRef.current;
    webStreamRef.current = nextStream;
    setWebStream(nextStream);
    setCameraReady(false);
    previousStream?.getTracks().forEach((track) => track.stop());
    setFlash('off');
    setCameraError(null);
  }, [facing]);

  const onNativeCameraReady = useCallback(async () => {
    setCameraReady(true);
    if (Platform.OS !== 'ios' || nativeLensFacing.current === facing) return;
    nativeLensFacing.current = facing;
    try {
      const lenses = await cameraRef.current?.getAvailableLensesAsync() || [];
      const options = getIosLensZoomOptions(lenses);
      setNativeZoomOptions(options);
      const defaultLens = options.find((option) => option.label === '1x') || options[0];
      setSelectedLens(defaultLens?.lens);
      setSelectedZoomLabel(defaultLens?.label || '1x');
    } catch {
      setNativeZoomOptions([]);
    }
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
          }, brightness, (review) => {
            if (shotIndexRef.current === shotIndex) {
              setQuality(review);
              setProject((current: any) => current ? {
                ...current,
                clips: (current.clips || []).map((clip: any) => clip.shot_index === shotIndex
                  ? { ...clip, quality: review } : clip),
                storyboard: (current.storyboard || []).map((item: any) => item.index === shotIndex
                  ? { ...item, status: review.recommendation === 'retake_required' ? 'retake' : 'captured' } : item),
              } : current);
            }
          }, (savedProject) => {
            setProject(savedProject);
          });
          setQuality((current: any) => current?.review_pending === false ? current : result);
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
    if (webDigitalZoomFrameRef.current !== null) cancelAnimationFrame(webDigitalZoomFrameRef.current);
    webDigitalZoomStreamRef.current?.getTracks().forEach((track) => track.stop());
    webStreamRef.current?.getTracks().forEach((track) => track.stop());
    webAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const shotObj = project?.storyboard?.[shotIndex];
  const zoomOptions = Platform.OS === 'web' ? webZoomOptions : nativeZoomOptions;

  const selectZoom = async (option: ZoomOption) => {
    setCameraError(null);
    if (Platform.OS === 'web') {
      if (option.digitalOnly) {
        setWebDigitalZoom(option.factor);
        setWebDigitalZoomActive(true);
        setSelectedZoomLabel(option.label);
        setCameraError(null);
        return;
      }
      const track = webStreamRef.current?.getVideoTracks()[0];
      if (!track || option.value === undefined) return;
      try {
        await track.applyConstraints({ advanced: [{ zoom: option.value }] } as any);
        setWebDigitalZoom(1);
        setWebDigitalZoomActive(false);
        setSelectedZoomLabel(option.label);
      } catch {
        if (option.factor >= 1) {
          setWebDigitalZoom(option.factor);
          setWebDigitalZoomActive(true);
          setSelectedZoomLabel(option.label);
          setCameraError(null);
        } else {
          setCameraError(t('zoom_unavailable'));
        }
      }
      return;
    }
    if (option.lens) {
      setSelectedLens(option.lens);
      setZoom(0);
    } else if (option.cameraZoom !== undefined) {
      setZoom(option.cameraZoom);
    }
    setSelectedZoomLabel(option.label);
  };

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
      drawCameraFrame(context, video, canvas.width, canvas.height,
        webDigitalZoomActive ? webDigitalZoom : 1);
      return canvas.toDataURL('image/jpeg', 0.4).split(',', 2)[1];
    }
    const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.4, skipProcessing: true });
    if (!photo?.base64) throw new Error('Could not capture a frame from the camera.');
    return photo.base64;
  }, [webDigitalZoom, webDigitalZoomActive]);

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
  }, [id, shotIndex]);

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
    setBrightnessOpen(false);
    if (Platform.OS === 'web') {
      try {
        const cameraStream = webStreamRef.current;
        if (!cameraStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
          throw new Error('The camera is not ready. Reopen the live camera and try again.');
        }
        if (typeof MediaRecorder === 'undefined') {
          throw new Error('Video recording is not supported by this browser. Try a current version of Safari or Chrome.');
        }
        const video = webVideoRef.current;
        let recordingVideoTracks = cameraStream.getVideoTracks();
        if (webDigitalZoomActive && webDigitalZoom > 1) {
          if (!video?.videoWidth || !video.videoHeight || typeof HTMLCanvasElement === 'undefined'
            || !HTMLCanvasElement.prototype.captureStream) {
            throw new Error('Digital zoom recording is unavailable in this browser. Choose 1x and try again.');
          }
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('The browser could not prepare the zoomed video.');
          const drawFrame = () => {
            drawCameraFrame(context, video, canvas.width, canvas.height, webDigitalZoom);
            webDigitalZoomFrameRef.current = requestAnimationFrame(drawFrame);
          };
          drawFrame();
          const zoomStream = canvas.captureStream(30);
          webDigitalZoomStreamRef.current = zoomStream;
          recordingVideoTracks = zoomStream.getVideoTracks();
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
          ...recordingVideoTracks,
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
        if (webDigitalZoomFrameRef.current !== null) cancelAnimationFrame(webDigitalZoomFrameRef.current);
        webDigitalZoomFrameRef.current = null;
        webDigitalZoomStreamRef.current?.getTracks().forEach((track) => track.stop());
        webDigitalZoomStreamRef.current = null;
        webAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
        webAudioStreamRef.current = null;
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
        }, brightness, (review) => {
          if (shotIndexRef.current === shotIndex) {
            setQuality(review);
            setProject((current: any) => current ? {
              ...current,
              clips: (current.clips || []).map((clip: any) => clip.shot_index === shotIndex
                ? { ...clip, quality: review } : clip),
              storyboard: (current.storyboard || []).map((item: any) => item.index === shotIndex
                ? { ...item, status: review.recommendation === 'retake_required' ? 'retake' : 'captured' } : item),
            } : current);
          }
        }, (savedProject) => {
          setProject(savedProject);
        });
        setQuality((current: any) => current?.review_pending === false ? current : q);
      }
    } catch (e) {
      console.warn('Recording or upload failed:', e);
      setCameraError(e instanceof Error ? e.message : 'Could not save this clip. Please try again.');
    } finally {
      recordingPromise.current = null;
      webRecorderRef.current = null;
      if (webDigitalZoomFrameRef.current !== null) cancelAnimationFrame(webDigitalZoomFrameRef.current);
      webDigitalZoomFrameRef.current = null;
      webDigitalZoomStreamRef.current?.getTracks().forEach((track) => track.stop());
      webDigitalZoomStreamRef.current = null;
      webAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
      webAudioStreamRef.current = null;
      stoppingRecording.current = false;
      setRecording(false);
      setAnalyzing(false);
    }
  };

  const nextShot = async () => {
    if (!id) return;
    const clips = project?.clips || [];
    const storyboard = project?.storyboard || [];
    const needsShot = (index: number) => storyboard[index]?.status !== 'skipped'
      && (!clips.some((clip: any) => Number(clip.shot_index) === index) || storyboard[index]?.status === 'retake');
    const afterCurrent = storyboard.findIndex((_item: any, index: number) => index > shotIndex && needsShot(index));
    const anyPending = afterCurrent >= 0 ? afterCurrent : storyboard.findIndex((_item: any, index: number) => needsShot(index));
    if (anyPending >= 0) {
      shotIndexRef.current = anyPending;
      setShotIndex(anyPending);
      setQuality(null);
      setCameraError(null);
      return;
    }
    setQuality(null);
    router.replace({ pathname: '/project/[id]/export', params: { id } });
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
        <Text style={styles.permTitle}>Camera access needed</Text>
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
      case 'none': return 'pause-circle-outline';
      default: return 'hand-left-outline';
    }
  };
  const currentMovement = String(shotObj?.camera_movement || 'static').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const storyboardShots = project?.storyboard || [];
  const savedShotIndexes = new Set((project?.clips || []).map((clip: any) => Number(clip.shot_index)));
  const needsShot = (index: number) => storyboardShots[index]?.status !== 'skipped'
    && (!savedShotIndexes.has(index) || storyboardShots[index]?.status === 'retake');
  const nextUnfilmedAfterCurrent = storyboardShots.findIndex((_item: any, index: number) => index > shotIndex && needsShot(index));
  const firstUnfilmedShot = storyboardShots.findIndex((_item: any, index: number) => needsShot(index));
  const upcomingShot = nextUnfilmedAfterCurrent >= 0 ? nextUnfilmedAfterCurrent : firstUnfilmedShot;
  const hasUpcomingShot = upcomingShot >= 0;
  const movementLabel = ['static', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'dolly_in', 'dolly_out', 'tracking', 'orbit', 'reveal', 'handheld'].includes(currentMovement)
    ? t(`move_${currentMovement}`) : t('hold_camera_steady');
  const shotInstruction = compactInstruction(shotObj, movementLabel);

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
            transform: `${facing === 'front' ? 'scaleX(-1) ' : ''}${webDigitalZoomActive && webDigitalZoom > 1 ? `scale(${webDigitalZoom})` : ''}`.trim() || undefined,
            transformOrigin: 'center center',
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
          onCameraReady={() => { void onNativeCameraReady(); }}
          facing={facing}
          flash={flash}
          zoom={zoom}
          selectedLens={selectedLens}
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
              <Ionicons
                name={instruction?.ready ? 'checkmark-circle' : arrowIcon(movementArrow(shotObj?.camera_movement)) as any}
                size={26}
                color={instruction?.ready ? theme.color.success : theme.color.brand}
              />
            )}
            <Text style={styles.instrText} numberOfLines={2}>{instruction?.ready && instruction.text ? instruction.text : shotInstruction}</Text>
            <Pressable onPress={requestDirection} disabled={directionBusy || recording} testID="camera-refresh-direction">
              <Ionicons name="refresh" size={20} color={directionBusy ? theme.color.onSurface3 : '#fff'} />
            </Pressable>
          </View>
        )}

        {!quality && <MovementGuide movement={shotObj?.camera_movement || 'static'} label={t('move_guide')} movementLabel={movementLabel} />}

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
                setSelectedLens(undefined);
                setSelectedZoomLabel('1x');
                setZoom(0);
                nativeLensFacing.current = null;
                if (Platform.OS !== 'web') setNativeZoomOptions(Platform.OS === 'ios' ? [] : ANDROID_ZOOM_OPTIONS);
                if (Platform.OS === 'web') void openWebCamera(nextFacing).catch((e: any) => setCameraError(e.message));
              }} testID="cam-flip" />
            <IconChip icon="sunny-outline" label={t('brightness')} on={brightnessOpen}
              onPress={() => setBrightnessOpen((value) => !value)} testID="cam-brightness" />
            {brightnessOpen && (
              <View style={styles.brightnessPopover}>
                <View style={styles.brightnessPopoverHeading}>
                  <Ionicons name="sunny-outline" size={16} color="#fff" />
                  <Text style={styles.brightnessLabel}>{t('brightness')}</Text>
                </View>
                <View style={styles.brightnessAdjustRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('brightness_down')}
                    onPress={() => setBrightness((value) => Math.max(-0.5, Math.round((value - 0.05) * 100) / 100))}
                    style={styles.brightnessButton} testID="cam-brightness-down">
                    <Ionicons name="remove" size={17} color="#fff" />
                  </Pressable>
                  <Text style={styles.brightnessValue}>{Math.round(brightness * 100)}%</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('brightness_up')}
                    onPress={() => setBrightness((value) => Math.min(0.5, Math.round((value + 0.05) * 100) / 100))}
                    style={styles.brightnessButton} testID="cam-brightness-up">
                    <Ionicons name="add" size={17} color="#fff" />
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Zoom slider */}
        {!quality && !recording && cameraReady && zoomOptions.length > 0 && (
          <View style={styles.zoomBar} pointerEvents="box-none">
            {zoomOptions.map((option) => (
              <Pressable key={`${option.label}-${option.lens || option.value || option.cameraZoom}`}
                onPress={() => { void selectZoom(option); }}
                style={[styles.zoomChip, selectedZoomLabel === option.label && styles.zoomChipOn]}
                accessibilityRole="button"
                accessibilityLabel={`${t('zoom')} ${option.label}`}
                accessibilityState={{ selected: selectedZoomLabel === option.label }}
                testID={`cam-zoom-${option.label}`}>
                <Text style={[styles.zoomText, selectedZoomLabel === option.label && { color: theme.color.brand }]}>{option.label}</Text>
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
                {quality.review_available === false && !quality.review_pending ? (
                  <Ionicons name="eye-outline" size={30} color={theme.color.warning} />
                ) : quality.review_pending ? (
                  <ActivityIndicator size="large" color={theme.color.brand} />
                ) : (
                  <View style={[styles.qBadge, { backgroundColor: quality.recommendation === 'retake_required' ? theme.color.error : quality.recommendation === 'retake_optional' ? theme.color.warning : theme.color.success }]}>
                    <Text style={styles.qBadgeText}>{Math.round(quality.overall_score)}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.qTitle}>{quality.review_pending ? t('rating_pending') : quality.review_available === false ? t('clip_saved') : quality.recommendation === 'keep' ? t('great_shot') : quality.recommendation === 'retake_optional' ? t('retake_suggested') : t('retake_required')}</Text>
                  <Text style={styles.qReason} numberOfLines={2}>{quality.review_pending ? quality.reason : quality.review_available === false ? t('rating_unavailable') : quality.reason}</Text>
                </View>
              </View>
              <Text style={styles.shotSavedCounter} testID="camera-shot-saved">
                {t('shot_saved_counter').replace('{current}', String(shotIndex + 1)).replace('{total}', String(project?.storyboard?.length || 1))}
              </Text>

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
                  <Text style={styles.primaryText}>{hasUpcomingShot
                    ? t('next_shot_counter').replace('{current}', String(upcomingShot + 1)).replace('{total}', String(storyboardShots.length))
                    : t('finish_edit')}</Text>
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
                <Text style={styles.analyzingText}>{t('saving_clip')}</Text>
              </View>
            ) : (
              <>
                {Platform.OS !== 'web' && (
                  <Pressable
                    onPress={() => setMode((current) => current === 'cinematic' ? 'video' : 'cinematic')}
                    style={[styles.modeChip, mode === 'cinematic' && styles.modeChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: mode === 'cinematic' }}
                    testID="cam-mode-cinematic">
                    <Ionicons name="film-outline" size={14} color={mode === 'cinematic' ? theme.color.brand : '#fff'} />
                    <Text style={[styles.modeText, mode === 'cinematic' && { color: theme.color.brand }]}>{t('stabilized_mode')}</Text>
                  </Pressable>
                )}

                <Text style={styles.timer}>{recording ? `${recSeconds.toFixed(1)}s / ${targetDur.toFixed(1)}s` : `${targetDur.toFixed(1)}s`}</Text>
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
    <Pressable style={[styles.iconChip, on && styles.iconChipOn]} onPress={onPress} testID={testID}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}>
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
  shotSavedCounter: { color: 'rgba(255,255,255,0.82)', fontSize: 12, fontWeight: '700', marginTop: 14 },
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
  sideCol: { position: 'absolute', right: 12, top: 120, gap: 10, zIndex: 4 },
  iconChip: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  iconChipOn: { borderWidth: 1, borderColor: theme.color.brand },
  brightnessPopover: {
    position: 'absolute', right: 50, top: 150, minWidth: 148, borderRadius: 14,
    backgroundColor: 'rgba(12,13,17,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    padding: 10, zIndex: 5,
  },
  brightnessPopoverHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  brightnessAdjustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  zoomBar: { position: 'absolute', bottom: 260, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6, zIndex: 3 },
  zoomChip: { minWidth: 40, paddingHorizontal: 10, height: 34, borderRadius: theme.radius.pill, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
  zoomChipOn: { backgroundColor: theme.color.brandTint, borderWidth: 1, borderColor: theme.color.brand },
  zoomText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  brightnessLabel: { color: '#fff', fontSize: 12, fontWeight: '700' },
  brightnessButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  brightnessValue: { color: '#fff', minWidth: 36, textAlign: 'center', fontSize: 12, fontWeight: '700' },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 32, borderRadius: theme.radius.pill, backgroundColor: 'rgba(0,0,0,0.55)', flexShrink: 0 },
  modeChipOn: { backgroundColor: theme.color.brandTint, borderWidth: 1, borderColor: theme.color.brand },
  modeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
