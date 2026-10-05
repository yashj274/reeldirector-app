import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { decode } from 'base64-arraybuffer';
import { getSupabase, hasSupabaseConfig } from '@/src/supabase';
import { getLanguage } from '@/src/i18n';

const configuredBackend = (Constants.expoConfig?.extra?.backendUrl || '').replace(/\/+$/, '');
function getBackendBase() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.protocol === 'http:') {
    if (!configuredBackend) return `http://${window.location.hostname}:8000`;
    try {
      const configuredHost = new URL(configuredBackend).hostname;
      const isLocalBackend = configuredHost === 'localhost'
        || /^127(?:\.\d{1,3}){3}$/.test(configuredHost)
        || /^10(?:\.\d{1,3}){3}$/.test(configuredHost)
        || /^192\.168(?:\.\d{1,3}){2}$/.test(configuredHost)
        || /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(configuredHost);
      if (isLocalBackend) return `http://${window.location.hostname}:8000`;
    } catch {
      // Keep the configured value below so request() can show its setup error.
    }
  }
  return Platform.OS === 'android'
    ? configuredBackend.replace(/^http:\/\/(?:127\.0\.0\.1|localhost)(?=:|$)/i, 'http://10.0.2.2')
    : configuredBackend;
}
const BASE = getBackendBase();
const TOKEN_KEY = 'reeldirector.token';
const USER_KEY = 'reeldirector.user';

export function friendlyAuthError(error: unknown, action: 'sign in' | 'create account') {
  const message = error instanceof Error ? error.message : '';
  if (/failed to fetch|network request failed|load failed|networkerror/i.test(message)) {
    return 'Could not connect to the account service. Check your internet connection and try again.';
  }
  if (/invalid login credentials|invalid email or password/i.test(message)) {
    return 'That email and password do not match. Check them and try again.';
  }
  if (/user already registered|already registered/i.test(message)) {
    return 'An account already exists for this email. Sign in instead.';
  }
  return message || `Could not ${action}. Please try again.`;
}

const TEMPLATES = [
  { id: 'wedding', name: 'Wedding Cinema', mood: 'Emotional • Romantic', duration: 45, style: 'cinematic', image: 'https://images.pexels.com/photos/33419097/pexels-photo-33419097.jpeg' },
  { id: 'travel', name: 'Travel Vlog', mood: 'Adventure • Wide', duration: 30, style: 'cinematic', image: 'https://images.unsplash.com/photo-1534196213718-bd643e406be4' },
  { id: 'food', name: 'Food Cinematic', mood: 'Warm • Macro', duration: 20, style: 'cinematic', image: 'https://images.unsplash.com/photo-1623594629187-2a68392cbab9?w=940' },
  { id: 'fashion', name: 'Fashion Editorial', mood: 'Bold • Editorial', duration: 25, style: 'editorial', image: 'https://images.unsplash.com/photo-1664076458686-3449062080ac?w=940' },
  { id: 'gym', name: 'Gym Motivation', mood: 'High Energy', duration: 20, style: 'action', image: 'https://images.unsplash.com/photo-1550345332-09e3ac987658?w=940' },
  { id: 'real_estate', name: 'Real Estate', mood: 'Luxury • Spacious', duration: 40, style: 'luxury', image: 'https://images.pexels.com/photos/33529500/pexels-photo-33529500.jpeg?w=940' },
  { id: 'product', name: 'Product Showcase', mood: 'Clean • Premium', duration: 15, style: 'minimal', image: 'https://images.unsplash.com/photo-1761701390293-27a1d3fa9df5?w=940' },
  { id: 'viral', name: 'Viral Reel', mood: 'Fast • Bold', duration: 15, style: 'fast_pace', image: 'https://images.pexels.com/photos/13327382/pexels-photo-13327382.jpeg?w=940' },
];

function profile(user: any) {
  const metadata = user?.user_metadata || {};
  return {
    id: user.id,
    email: user.email,
    name: metadata.name || metadata.full_name || 'Director',
    plan: metadata.plan || 'free',
  };
}

async function currentUser() {
  const client = getSupabase();
  const { data: { user }, error } = await client.auth.getUser();
  if (/auth session missing|session not found/i.test(error?.message || '')) {
    throw new Error('Please sign in on this device before creating or editing projects.');
  }
  if (error) throw error;
  if (!user) throw new Error('Please sign in on this device before creating or editing projects.');
  return user;
}

export async function getToken(): Promise<string | null> {
  if (!hasSupabaseConfig()) return null;
  const { data, error } = await getSupabase().auth.getSession();
  if (error) return null;
  return data.session?.access_token || null;
}

export async function getUser(): Promise<any | null> {
  if (!hasSupabaseConfig()) return null;
  const { data, error } = await getSupabase().auth.getSession();
  return error || !data.session?.user ? null : profile(data.session.user);
}

export async function clearAuth() {
  if (hasSupabaseConfig()) await getSupabase().auth.signOut();
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}

async function request(path: string, opts: RequestInit = {}): Promise<any> {
  if (!BASE) {
    throw new Error('ReelDirector backend URL is not configured. Set REELDIRECTOR_API_URL in frontend/.env.local and rebuild.');
  }
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  } catch {
    throw new Error(`Can’t reach the ReelDirector service at ${BASE}. Start the backend and check REELDIRECTOR_API_URL in frontend/.env.local.`);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

async function readProject(id: string) {
  const user = await currentUser();
  const { data, error } = await getSupabase().from('projects').select('data')
    .eq('id', id).eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  if (!data?.data) throw new Error('Project not found');
  const project = data.data;
  const assets: { path: string; apply: (url: string | null) => void }[] = [];
  if (project.export?.storage_path) assets.push({ path: project.export.storage_path, apply: (url) => { project.export.url = url; } });
  if (project.soundtrack?.storage_path) assets.push({ path: project.soundtrack.storage_path, apply: (url) => { project.soundtrack.signed_url = url; } });
  if (project.voiceover?.storage_path) assets.push({ path: project.voiceover.storage_path, apply: (url) => { project.voiceover.signed_url = url; } });
  for (const clip of project.clips || []) {
    if (clip.video_storage_path) assets.push({ path: clip.video_storage_path, apply: (url) => { clip.video_url = url; } });
    if (clip.frame_storage_path) assets.push({ path: clip.frame_storage_path, apply: (url) => { clip.frame_url = url; } });
  }
  if (assets.length) {
    const paths = [...new Set(assets.map((asset) => asset.path))];
    const { data: signed, error: signError } = await getSupabase().storage.from('project-media')
      .createSignedUrls(paths, 3600);
    if (signError) throw signError;
    const urlByPath = new Map((signed || []).map((entry) => [entry.path, entry.signedUrl]));
    for (const asset of assets) asset.apply(urlByPath.get(asset.path) || null);
  }
  return project;
}

async function updateProjectData(project: any) {
  const user = await currentUser();
  const { error } = await getSupabase().from('projects').update({
    data: project,
    updated_at: new Date().toISOString(),
  }).eq('id', project.id).eq('user_id', user.id);
  if (error) throw error;
}

async function deleteStoredFrames(paths: string[]) {
  if (!paths.length || !hasSupabaseConfig()) return;
  const { error } = await getSupabase().storage.from('project-media').remove(paths);
  if (error) console.warn('Unable to remove stored frame images:', error.message);
}

async function saveAudioTrack(
  projectId: string,
  track: 'soundtrack' | 'voiceover',
  file: { uri: string; name: string; mimeType?: string; file?: Blob },
) {
  const user = await currentUser();
  const project = await readProject(projectId);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || `${track}.mp3`;
  const storagePath = `${user.id}/${projectId}/audio/${stamp}-${safeName}`;
  const { File } = await import('expo-file-system');
  const bytes = file.file ? await file.file.arrayBuffer() : await new File(file.uri).arrayBuffer();
  const { error } = await getSupabase().storage.from('project-media').upload(storagePath, bytes, {
    contentType: file.mimeType || 'audio/mpeg', upsert: false,
  });
  if (error) throw error;
  const oldPath = project[track]?.storage_path;
  const audioTrack = { storage_path: storagePath, title: file.name, content_type: file.mimeType || 'audio/mpeg' };
  try {
    await updateProjectData({ ...project, [track]: audioTrack, updated_at: new Date().toISOString() });
  } catch (updateError) {
    await deleteStoredFrames([storagePath]);
    throw updateError;
  }
  if (oldPath) await deleteStoredFrames([oldPath]);
  return { ...audioTrack, signed_url: (await readProject(projectId))[track]?.signed_url };
}

async function removeAudioTrack(projectId: string, track: 'soundtrack' | 'voiceover') {
  const project = await readProject(projectId);
  const oldPath = project[track]?.storage_path;
  const updated = { ...project };
  delete updated[track];
  await updateProjectData({ ...updated, updated_at: new Date().toISOString() });
  if (oldPath) await deleteStoredFrames([oldPath]);
}

export const api = {
  signup: async (email: string, password: string, name: string) => {
    const emailRedirectTo = Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback`
      : Linking.createURL('auth/callback');
    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: {
        data: { name, full_name: name, plan: 'free' },
        emailRedirectTo,
      },
    });
    if (error) throw error;
    return { user: data.user ? profile(data.user) : null, requiresEmailConfirmation: !data.session };
  },
  login: async (email: string, password: string) => {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.session) throw new Error('Confirm your email before signing in.');
    return { user: profile(data.user) };
  },
  requestPasswordReset: async (email: string) => {
    const resetPath = '/(auth)/reset-password?mode=update';
    const redirectTo = Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback?${new URLSearchParams({ next: resetPath }).toString()}`
      : Linking.createURL('auth/callback', { queryParams: { next: resetPath } });
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    return { ok: true };
  },
  updatePassword: async (password: string) => {
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) throw error;
    return { ok: true };
  },
  me: async () => profile(await currentUser()),
  templates: async () => TEMPLATES,
  createProject: async (payload: any) => {
    const user = await currentUser();
    const now = new Date().toISOString();
    const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
    const project = {
      id, user_id: user.id, ...payload, status: 'draft', storyboard: null,
      scene_map: null, clips: [], export_url: null, thumbnail_url: null,
      created_at: now, updated_at: now,
    };
    const { error } = await getSupabase().from('projects').insert({
      id, user_id: user.id, data: project, created_at: now, updated_at: now,
    });
    if (error) throw error;
    return project;
  },
  listProjects: async () => {
    const user = await currentUser();
    const { data, error } = await getSupabase().from('projects').select('data')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return (data || []).map((row: any) => row.data);
  },
  getProject: readProject,
  saveEditSettings: async (id: string, settings: Record<string, any>) => {
    const project = await readProject(id);
    await updateProjectData({ ...project, edit_settings: settings, updated_at: new Date().toISOString() });
    return { ok: true };
  },
  deleteProject: async (id: string) => {
    const user = await currentUser();
    const { data, error: readError } = await getSupabase().from('projects').select('data')
      .eq('id', id).eq('user_id', user.id).maybeSingle();
    if (readError) throw readError;
    if (!data?.data) throw new Error('Project not found');
    const project = data.data;
    const projectPrefix = `${user.id}/${id}/`;
    const paths: string[] = [
      ...(project.clips || []).flatMap((clip: any) => [clip.frame_storage_path, clip.video_storage_path]),
      project.soundtrack?.storage_path,
      project.voiceover?.storage_path,
      project.export?.storage_path,
    ].filter((path: unknown): path is string => typeof path === 'string' && path.startsWith(projectPrefix));
    const { error } = await getSupabase().from('projects').delete()
      .eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await deleteStoredFrames(paths);
    return { ok: true };
  },
  storyboard: async (id: string) => request(`/projects/${id}/storyboard`, {
    method: 'POST', body: JSON.stringify({ language: await getLanguage() }),
  }),
  scan: async (project_id: string, image_base64: string, frames: string[] = []) => request('/scan', {
    method: 'POST', body: JSON.stringify({ project_id, image_base64, frames, language: await getLanguage() }),
  }),
  director: async (project_id: string, shot_index: number, image_base64?: string) =>
    request('/director/instruct', {
      method: 'POST', body: JSON.stringify({ project_id, shot_index, image_base64, language: await getLanguage() }),
    }),
  clipQuality: async (
    project_id: string,
    shot_index: number,
    frame_base64: string,
    duration_seconds: number,
    video: { uri?: string; blob?: Blob; mimeType?: string },
    brightness = 0,
    onReview?: (quality: any) => void,
    onSaved?: (project: any) => void,
  ) => {
    const user = await currentUser();
    const language = await getLanguage();
    const prefix = `${user.id}/${project_id}`;
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const frame_storage_path = `${prefix}/${stamp}.jpg`;
    if (!video.uri && !video.blob) throw new Error('The recorded video is missing. Record the shot again.');
    const inferredMimeType = video.uri?.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
    const mimeType = (video.mimeType || video.blob?.type || inferredMimeType).split(';')[0].trim();
    const extension = mimeType === 'video/webm' ? 'webm' : mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    const video_storage_path = `${prefix}/${stamp}.${extension}`;
    const uploaded: string[] = [];
    try {
      const storage = getSupabase().storage.from('project-media');
      const videoBytes = video.blob
        ? video.blob
        : await new (await import('expo-file-system')).File(video.uri!).arrayBuffer();
      const [frameUpload, videoUpload] = await Promise.all([
        storage.upload(frame_storage_path, decode(frame_base64), { contentType: 'image/jpeg', upsert: false }),
        storage.upload(video_storage_path, videoBytes, { contentType: mimeType, upsert: false }),
      ]);
      if (!frameUpload.error) uploaded.push(frame_storage_path);
      if (!videoUpload.error) uploaded.push(video_storage_path);
      if (frameUpload.error) throw frameUpload.error;
      if (videoUpload.error) throw videoUpload.error;

      const pendingQuality = {
        overall_score: null, blur_score: null, exposure_score: null, composition_score: null,
        stability_score: null, subject_visible: null, issues: [], recommendation: 'keep',
        review_available: false, review_pending: true,
        reason: 'Your clip is saved. AI is checking the framing in the background.',
      };
      const [project, signedResult] = await Promise.all([
        readProject(project_id),
        storage.createSignedUrls([frame_storage_path, video_storage_path], 3600),
      ]);
      if (signedResult.error) throw signedResult.error;
      const signedByPath = new Map((signedResult.data || []).map((item) => [item.path, item.signedUrl]));
      const clip = {
        shot_index, clip_id: stamp, duration_seconds, quality: pendingQuality,
        brightness: Math.max(-0.5, Math.min(0.5, brightness)), recorded_at: new Date().toISOString(),
        frame_storage_path, video_storage_path,
        frame_url: signedByPath.get(frame_storage_path) || null,
        video_url: signedByPath.get(video_storage_path) || null,
      };
      const replacedClips = (project.clips || []).filter((item: any) => item.shot_index === shot_index);
      const clips = [...(project.clips || []).filter((item: any) => item.shot_index !== shot_index), clip];
      clips.sort((a: any, b: any) => a.shot_index - b.shot_index);
      const storyboard = project.storyboard || [];
      if (storyboard[shot_index]) storyboard[shot_index].status = 'captured';
      const savedProject = { ...project, clips, storyboard, status: 'shooting' };
      await updateProjectData(savedProject);
      void deleteStoredFrames(replacedClips.flatMap((item: any) => [item.frame_storage_path, item.video_storage_path]).filter(Boolean));
      onSaved?.(savedProject);

      // Let the creator move to the next shot while Gemini reviews this frame.
      void request('/clips/quality', {
          method: 'POST',
          body: JSON.stringify({ project_id, shot_index, frame_base64, duration_seconds, brightness, language, frame_storage_path, video_storage_path }),
        }).then(async (quality) => {
          const latest = await readProject(project_id);
          const current = (latest.clips || []).find((item: any) => item.clip_id === stamp);
          if (!current) return;
          current.quality = { ...quality, review_pending: false };
          if (latest.storyboard?.[shot_index]) {
            latest.storyboard[shot_index].status = quality.recommendation === 'retake_required' ? 'retake' : 'captured';
          }
          await updateProjectData(latest);
          onReview?.({ ...quality, review_pending: false });
        }).catch((error) => {
          console.warn('Background clip review failed:', error);
          const unavailable = { ...pendingQuality, review_pending: false, reason: 'Clip saved. Automatic review is unavailable right now.' };
          void readProject(project_id).then(async (latest) => {
            const current = (latest.clips || []).find((item: any) => item.clip_id === stamp);
            if (!current) return;
            current.quality = unavailable;
            await updateProjectData(latest);
          }).catch(() => {});
          onReview?.(unavailable);
        });
      return pendingQuality;
    } catch (error) {
      await deleteStoredFrames(uploaded);
      throw error;
    }
  },
  saveSoundtrack: async (project_id: string, file: { uri: string; name: string; mimeType?: string; file?: Blob }) =>
    saveAudioTrack(project_id, 'soundtrack', file),
  removeSoundtrack: async (project_id: string) => removeAudioTrack(project_id, 'soundtrack'),
  saveVoiceover: async (project_id: string, file: { uri: string; name: string; mimeType?: string; file?: Blob }) =>
    saveAudioTrack(project_id, 'voiceover', file),
  removeVoiceover: async (project_id: string) => removeAudioTrack(project_id, 'voiceover'),
  updateStoryboard: async (id: string, shots: any[]) => {
    const project = await readProject(id);
    for (let i = 0; i < shots.length; i++) {
      shots[i].index = i;
      shots[i].status ??= 'pending';
    }
    await updateProjectData({ ...project, storyboard: shots, storyboard_user_edited: true, updated_at: new Date().toISOString() });
    return { storyboard: shots };
  },
  regenerateShot: async (id: string, shot_index: number, notes?: string) => request(`/projects/${id}/storyboard/regenerate`, {
    method: 'POST', body: JSON.stringify({ shot_index, notes, language: await getLanguage() }),
  }),
  retakeShot: async (id: string, shot_index: number) => {
    const project = await readProject(id);
    const removed = (project.clips || []).filter((clip: any) => clip.shot_index === shot_index);
    const clips = (project.clips || []).filter((clip: any) => clip.shot_index !== shot_index);
    const storyboard = project.storyboard || [];
    if (storyboard[shot_index]) storyboard[shot_index].status = 'pending';
    await updateProjectData({ ...project, clips, storyboard, updated_at: new Date().toISOString() });
    await deleteStoredFrames(removed.flatMap((clip: any) => [
      clip.frame_storage_path, clip.video_storage_path,
    ]).filter(Boolean));
    return { ok: true, shot_index };
  },
  export: async (
    id: string,
    opts: {
      aspect_ratio?: string; fit_mode?: string; resolution?: string; fps?: number; editing_style?: string;
      clip_order?: number[]; clip_edits?: Record<string, any>[];
      caption_edits?: Record<string, any>[];
      title_text?: string; title_font?: string; title_position?: string;
      title_color?: string; title_size?: string; music_volume?: number; voiceover_volume?: number; original_volume?: number;
      captions_enabled?: boolean;
    } = {},
    onProgress?: (status: string) => void,
  ) => {
    const project = await readProject(id);
    const exportOptions: Record<string, any> = {
      ...(project.edit_settings || {}), ...opts,
      render_provider: 'ffmpeg', show_shot_titles: false,
    };
    if (typeof exportOptions.music_volume === 'number' && exportOptions.music_volume > 1) {
      exportOptions.music_volume /= 100;
    }
    if (typeof exportOptions.voiceover_volume === 'number' && exportOptions.voiceover_volume > 1) {
      exportOptions.voiceover_volume /= 100;
    }
    if (typeof exportOptions.original_volume === 'number' && exportOptions.original_volume > 1) {
      exportOptions.original_volume /= 100;
    }
    const result = await request(`/projects/${id}/export`, {
      method: 'POST', body: JSON.stringify(exportOptions),
    });
    onProgress?.('completed');
    return result;
  },
};
