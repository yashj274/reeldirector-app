import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { decode } from 'base64-arraybuffer';
import { getSupabase, hasSupabaseConfig } from '@/src/supabase';
import { getLanguage } from '@/src/i18n';
import { logBeta } from '@/src/betaLog';
import { toEditProject } from '@/src/editor/project';

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
const CREATOR_SKILL_KEY = 'reeldirector.creatorSkill';
const CREATOR_STYLE_KEY = 'reeldirector.creatorStyleProfile';
const PROJECT_CACHE_PREFIX = 'reeldirector.project.';
const PROJECT_INDEX_PREFIX = 'reeldirector.projects.';
const PENDING_CREATE_PREFIX = 'reeldirector.project-create.';
const BACKEND_WARM_KEY = 'reeldirector.backend.lastHealthy';
const MAX_CACHED_PROJECTS = 10;
export type CreatorSkillLevel = 'beginner' | 'creator' | 'pro';
export type CreatorStyle = 'cinematic' | 'fast_pace' | 'minimal' | 'editorial' | 'luxury' | 'action';
export type CreatorStyleMood = 'Cinematic' | 'Emotional' | 'Energetic' | 'Luxury' | 'Minimal' | 'Warm';
export type CreatorStyleProfile = {
  style: CreatorStyle;
  mood: CreatorStyleMood;
  duration_seconds: number;
  category: string;
  goal: string;
  pacing: string;
  text_amount: string;
  movements: string[];
  project_count: number;
  has_preferences: boolean;
};
type StyleSnapshot = Partial<Omit<CreatorStyleProfile, 'project_count'>> & { project_id: string };
type CreatorStyleRecord = { preferences: Partial<Pick<CreatorStyleProfile, 'style' | 'mood' | 'duration_seconds'>>; recent: StyleSnapshot[]; total: number };
const isCreatorSkillLevel = (value: unknown): value is CreatorSkillLevel =>
  value === 'beginner' || value === 'creator' || value === 'pro';
const CREATOR_STYLES: CreatorStyle[] = ['cinematic', 'fast_pace', 'minimal', 'editorial', 'luxury', 'action'];
const CREATOR_MOODS: CreatorStyleMood[] = ['Cinematic', 'Emotional', 'Energetic', 'Luxury', 'Minimal', 'Warm'];
const CREATOR_DURATIONS = [15, 20, 30, 45, 60];
const CREATOR_CATEGORIES = ['wedding', 'travel', 'food', 'fashion', 'gym', 'product', 'real_estate', 'cafe', 'restaurant', 'event', 'documentary', 'business', 'lifestyle', 'daily_vlog', 'social_media', 'cinematic', 'other'];
const CREATOR_GOALS = ['storytelling', 'showcase', 'sales', 'education', 'entertainment', 'memory', 'brand_awareness'];
const CREATOR_PACING = ['relaxed', 'balanced', 'fast'];
const CREATOR_TEXT_AMOUNT = ['minimal', 'some', 'more'];
const CREATOR_MOVEMENTS = ['static', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'dolly_in', 'dolly_out', 'tracking', 'orbit', 'reveal', 'handheld'];
const SIGNED_URL_CACHE_TTL_MS = 50 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
let backendHealthyAt = 0;
let backendWarmupRequest: Promise<void> | null = null;
const pendingProjectCreates = new Map<string, Promise<any>>();

type CachedProject = { project: any; pending: boolean; remoteUpdatedAt: string | null; conflict?: boolean };

function projectCacheKey(userId: string, projectId: string) {
  return `${PROJECT_CACHE_PREFIX}${userId}.${projectId}`;
}

function withoutTemporaryUrls(project: any) {
  const copy = JSON.parse(JSON.stringify(project));
  delete copy.local_recovery;
  delete copy.local_sync_pending;
  delete copy.local_sync_conflict;
  if (copy.export) delete copy.export.url;
  if (copy.export) delete copy.export.thumbnail_url;
  delete copy.export_url;
  delete copy.thumbnail_url;
  if (copy.soundtrack) delete copy.soundtrack.signed_url;
  if (copy.voiceover) delete copy.voiceover.signed_url;
  for (const clip of copy.clips || []) {
    delete clip.video_url;
    delete clip.frame_url;
  }
  for (const track of copy.edit_json?.tracks || []) for (const item of track.items || []) delete item.signed_url;
  return copy;
}

async function readCachedProject(userId: string, projectId: string): Promise<CachedProject | null> {
  try {
    const value = await AsyncStorage.getItem(projectCacheKey(userId, projectId));
    if (!value) return null;
    const parsed = JSON.parse(value);
    // Older cache entries held only the project document.
    return parsed?.project
      ? parsed as CachedProject
      : { project: parsed, pending: false, remoteUpdatedAt: parsed?.updated_at || null };
  } catch {
    return null;
  }
}

async function rememberProject(userId: string, project: any, remoteUpdatedAt: string | null, pending = false, conflict = false) {
  const clean = withoutTemporaryUrls(project);
  try {
    await AsyncStorage.setItem(projectCacheKey(userId, clean.id), JSON.stringify({
      project: clean, pending, remoteUpdatedAt, conflict,
    } satisfies CachedProject));
    const indexKey = `${PROJECT_INDEX_PREFIX}${userId}`;
    const ids = JSON.parse(await AsyncStorage.getItem(indexKey) || '[]') as string[];
    const nextIds = [clean.id, ...ids.filter((id) => id !== clean.id)].slice(0, MAX_CACHED_PROJECTS);
    await AsyncStorage.setItem(indexKey, JSON.stringify(nextIds));
    const staleIds = ids.filter((id) => !nextIds.includes(id));
    if (staleIds.length) await AsyncStorage.multiRemove(staleIds.map((id) => projectCacheKey(userId, id)));
    return true;
  } catch (error) {
    console.warn('Project recovery cache could not be updated:', error);
    return false;
  }
}

async function cachedProjects(userId: string) {
  try {
    const ids = JSON.parse(await AsyncStorage.getItem(`${PROJECT_INDEX_PREFIX}${userId}`) || '[]') as string[];
    const entries = await Promise.all(ids.map((id) => readCachedProject(userId, id)));
    return entries.flatMap((entry) => entry ? [{ ...entry.project, local_recovery: true }] : []);
  } catch {
    return [];
  }
}

async function removeFromProjectIndex(userId: string, projectId: string) {
  try {
    const value = await AsyncStorage.getItem(`${PROJECT_INDEX_PREFIX}${userId}`);
    const ids = JSON.parse(value || '[]') as string[];
    await AsyncStorage.setItem(`${PROJECT_INDEX_PREFIX}${userId}`, JSON.stringify(ids.filter((id) => id !== projectId)));
    await AsyncStorage.removeItem(projectCacheKey(userId, projectId));
  } catch { /* The cloud deletion is still complete if local cleanup fails. */ }
}

function friendlyServiceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/429|rate.?limit|resource_exhausted|quota/i.test(message)) {
    return new Error('AI is busy right now. Your project is safe; please try again in a moment.');
  }
  if (/failed to fetch|network request failed|load failed|networkerror|timed? ?out|502|503|504|did not respond/i.test(message)) {
    return new Error('This service is taking longer to respond. Your saved progress is safe; please try again shortly.');
  }
  return error instanceof Error ? error : new Error('Something went wrong. Please try again.');
}

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
    creator_skill_level: isCreatorSkillLevel(metadata.creator_skill_level) ? metadata.creator_skill_level : 'beginner',
  };
}

export async function getCreatorSkillLevel(): Promise<CreatorSkillLevel> {
  const local = await AsyncStorage.getItem(CREATOR_SKILL_KEY);
  if (!hasSupabaseConfig()) return isCreatorSkillLevel(local) ? local : 'beginner';
  const { data } = await getSupabase().auth.getSession();
  const saved = data.session?.user.user_metadata?.creator_skill_level;
  if (isCreatorSkillLevel(saved)) {
    await AsyncStorage.setItem(CREATOR_SKILL_KEY, saved);
    return saved;
  }
  return isCreatorSkillLevel(local) ? local : 'beginner';
}

export async function setCreatorSkillLevel(level: CreatorSkillLevel): Promise<void> {
  await AsyncStorage.setItem(CREATOR_SKILL_KEY, level);
  if (!hasSupabaseConfig()) return;
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  if (data.session) {
    const result = await getSupabase().auth.updateUser({ data: { creator_skill_level: level } });
    if (result.error) throw result.error;
  }
}

function cleanStyleRecord(value: any): CreatorStyleRecord {
  const rawPreferences = value?.preferences || {};
  const preferences: CreatorStyleRecord['preferences'] = {};
  if (CREATOR_STYLES.includes(rawPreferences.style)) preferences.style = rawPreferences.style;
  if (CREATOR_MOODS.includes(rawPreferences.mood)) preferences.mood = rawPreferences.mood;
  if (CREATOR_DURATIONS.includes(rawPreferences.duration_seconds)) preferences.duration_seconds = rawPreferences.duration_seconds;
  const recent = Array.isArray(value?.recent) ? value.recent.filter((item: any) => item && typeof item.project_id === 'string').slice(-12).map((item: any) => {
    const clean: StyleSnapshot = { project_id: item.project_id.slice(0, 64) };
    for (const field of ['style', 'mood', 'category', 'goal', 'pacing', 'text_amount'] as const) {
      const allowed = field === 'style' ? CREATOR_STYLES : field === 'mood' ? CREATOR_MOODS
        : field === 'category' ? CREATOR_CATEGORIES : field === 'goal' ? CREATOR_GOALS
          : field === 'pacing' ? CREATOR_PACING : CREATOR_TEXT_AMOUNT;
      if (allowed.includes(item[field])) (clean as any)[field] = item[field];
    }
    if (CREATOR_DURATIONS.includes(item.duration_seconds)) clean.duration_seconds = item.duration_seconds;
    clean.movements = Array.isArray(item.movements) ? item.movements.filter((movement: unknown) => CREATOR_MOVEMENTS.includes(movement as string)).slice(0, 6) : [];
    return clean;
  }) : [];
  return { preferences, recent, total: Math.max(recent.length, Number(value?.total) || 0) };
}

function creatorStyleStorageKey(userId?: string) {
  return userId ? `${CREATOR_STYLE_KEY}.${userId}` : CREATOR_STYLE_KEY;
}

async function readCreatorStyleRecord(): Promise<CreatorStyleRecord> {
  let userId: string | undefined;
  let saved: any;
  try {
    if (hasSupabaseConfig()) {
      const { data, error } = await getSupabase().auth.getSession();
      if (!error && data.session) {
        userId = data.session.user.id;
        saved = data.session.user.user_metadata?.creator_style_profile;
      }
    }
  } catch { /* Keep the device copy available offline. */ }
  let local: CreatorStyleRecord = { preferences: {}, recent: [], total: 0 };
  try { local = cleanStyleRecord(JSON.parse(await AsyncStorage.getItem(creatorStyleStorageKey(userId)) || 'null')); } catch { /* Use an empty profile if local data is unavailable. */ }
  if (saved) {
    const remote = cleanStyleRecord(saved);
    void AsyncStorage.setItem(creatorStyleStorageKey(userId), JSON.stringify(remote)).catch(() => {});
    return remote;
  }
  return local;
}

async function writeCreatorStyleRecord(record: CreatorStyleRecord): Promise<void> {
  const clean = cleanStyleRecord(record);
  let userId: string | undefined;
  if (hasSupabaseConfig()) {
    const { data, error } = await getSupabase().auth.getSession();
    if (error) throw error;
    userId = data.session?.user.id;
    if (data.session) {
      const result = await getSupabase().auth.updateUser({ data: { creator_style_profile: clean } });
      if (result.error) throw result.error;
    }
  }
  await AsyncStorage.setItem(creatorStyleStorageKey(userId), JSON.stringify(clean));
}

function mostUsed<T extends string | number>(recent: StyleSnapshot[], field: keyof Omit<StyleSnapshot, 'project_id' | 'movements'>, fallback: T): T {
  const counts = new Map<string | number, number>();
  for (const entry of recent) {
    const value = entry[field];
    if (typeof value === 'string' || typeof value === 'number') counts.set(value, (counts.get(value) || 0) + 1);
  }
  return ([...counts].sort((a, b) => b[1] - a[1])[0]?.[0] as T | undefined) ?? fallback;
}

export async function getCreatorStyleProfile(): Promise<CreatorStyleProfile> {
  const record = await readCreatorStyleRecord();
  const { preferences, recent } = record;
  const movementCounts = new Map<string, number>();
  recent.forEach((entry) => entry.movements?.forEach((movement) => movementCounts.set(movement, (movementCounts.get(movement) || 0) + 1)));
  const movements = [...movementCounts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([movement]) => movement);
  return {
    style: preferences.style || mostUsed(recent, 'style', 'cinematic'),
    mood: preferences.mood || mostUsed(recent, 'mood', 'Cinematic'),
    duration_seconds: preferences.duration_seconds || mostUsed(recent, 'duration_seconds', 30),
    category: mostUsed(recent, 'category', 'social_media'),
    goal: mostUsed(recent, 'goal', 'storytelling'),
    pacing: mostUsed(recent, 'pacing', 'balanced'),
    text_amount: mostUsed(recent, 'text_amount', 'minimal'),
    movements,
    project_count: record.total,
    has_preferences: Object.keys(preferences).length > 0,
  };
}

export async function saveCreatorStylePreferences(preferences: Partial<Pick<CreatorStyleProfile, 'style' | 'mood' | 'duration_seconds'>>) {
  const record = await readCreatorStyleRecord();
  const next = cleanStyleRecord({ ...record, preferences: { ...record.preferences, ...preferences } });
  await writeCreatorStyleRecord(next);
  return getCreatorStyleProfile();
}

export async function resetCreatorStyleProfile() {
  let userId: string | undefined;
  if (hasSupabaseConfig()) {
    const { data, error } = await getSupabase().auth.getSession();
    if (error) throw error;
    userId = data.session?.user.id;
    if (data.session) {
      const result = await getSupabase().auth.updateUser({ data: { creator_style_profile: null } });
      if (result.error) throw result.error;
    }
  }
  await AsyncStorage.removeItem(creatorStyleStorageKey(userId));
}

function styleSnapshot(project: any): StyleSnapshot {
  const purpose = String(project?.purpose || '').toLowerCase();
  const goal = /sell|sale|order|shop|book|buy|launch/.test(purpose) ? 'sales'
    : /teach|learn|how to|tutorial|explain|guide/.test(purpose) ? 'education'
      : /brand|business|company|promote/.test(purpose) ? 'brand_awareness'
        : /remember|memory|anniversary|wedding|birthday|family/.test(purpose) ? 'memory'
          : /funny|entertain|viral|trend/.test(purpose) ? 'entertainment'
            : /show|feature|product|portfolio/.test(purpose) ? 'showcase' : 'storytelling';
  const shots = Array.isArray(project?.storyboard) ? project.storyboard : [];
  const averageShot = shots.length ? Number(project?.duration_seconds || 30) / shots.length : 4;
  const edit = project?.edit_settings || {};
  const captions = !!edit.captions_enabled;
  const titleText = String(edit.title_text || '').trim().length > 0;
  const rawDuration = Number(project?.duration_seconds) || 30;
  const duration = CREATOR_DURATIONS.reduce((best, value) => Math.abs(value - rawDuration) < Math.abs(best - rawDuration) ? value : best, 30);
  const movementNames = new Set<string>();
  shots.forEach((shot: any) => {
    const movement = String(shot?.camera_movement || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (CREATOR_MOVEMENTS.includes(movement)) movementNames.add(movement);
  });
  return {
    project_id: String(project?.id || '').slice(0, 64),
    style: CREATOR_STYLES.includes(project?.style) ? project.style : 'cinematic',
    mood: CREATOR_MOODS.includes(project?.mood) ? project.mood : 'Cinematic',
    duration_seconds: duration,
    category: CREATOR_CATEGORIES.includes(project?.shoot_type) ? project.shoot_type : 'other',
    goal,
    pacing: averageShot <= 3 ? 'fast' : averageShot >= 6 ? 'relaxed' : 'balanced',
    text_amount: captions && titleText ? 'more' : captions || titleText ? 'some' : 'minimal',
    movements: [...movementNames].slice(0, 6),
  };
}

async function rememberCreatorStyleChoice(project: any) {
  if (!project?.id) return;
  try {
    const record = await readCreatorStyleRecord();
    const snapshot = styleSnapshot(project);
    const existed = record.recent.some((entry) => entry.project_id === snapshot.project_id);
    const recent = [...record.recent.filter((entry) => entry.project_id !== snapshot.project_id), snapshot].slice(-12);
    await writeCreatorStyleRecord({ ...record, recent, total: record.total + (existed ? 0 : 1) });
  } catch { /* Style learning is optional; project work must continue offline. */ }
}

export type DirectorCommand = 'move_left' | 'move_right' | 'move_forward' | 'move_backward' | 'tilt_up' | 'tilt_down' | 'hold_steady' | 'subject_left' | 'subject_right' | 'improve_lighting' | 'ready_to_record' | 'start_recording' | 'stop_recording';
export type DirectorGuidance = { command: DirectorCommand; message: string; ready: boolean; confidence: number; personalized?: boolean };

function directorCommand(raw: any): DirectorCommand {
  if (raw?.ready) return 'ready_to_record';
  switch (raw?.arrow_direction) {
    case 'left': return 'move_left';
    case 'right': return 'move_right';
    case 'forward': return 'move_forward';
    case 'back': return 'move_backward';
    case 'up': return 'tilt_up';
    case 'down': return 'tilt_down';
    default: return 'hold_steady';
  }
}

async function currentUser() {
  const client = getSupabase();
  // This runs in the client. Project and storage access are still enforced by
  // Supabase RLS; reading the refreshed local session avoids an Auth network
  // round trip every time a project is loaded or saved.
  const { data: { session }, error } = await client.auth.getSession();
  if (/auth session missing|session not found/i.test(error?.message || '')) {
    throw new Error('Please sign in on this device before creating or editing projects.');
  }
  if (error) throw error;
  if (!session?.user) throw new Error('Please sign in on this device before creating or editing projects.');
  return session.user;
}

async function signMediaPaths(paths: string[]) {
  const now = Date.now();
  const urls = new Map<string, string>();
  const missing: string[] = [];
  for (const path of [...new Set(paths)]) {
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > now) urls.set(path, cached.url);
    else {
      signedUrlCache.delete(path);
      missing.push(path);
    }
  }
  if (!missing.length) return urls;

  const { data, error } = await getSupabase().storage.from('project-media')
    .createSignedUrls(missing, 3600);
  if (error) throw error;
  for (const item of data || []) {
    if (!item.path || !item.signedUrl) continue;
    urls.set(item.path, item.signedUrl);
    signedUrlCache.set(item.path, { url: item.signedUrl, expiresAt: now + SIGNED_URL_CACHE_TTL_MS });
  }
  // Keep the in-memory cache bounded on long-running sessions.
  while (signedUrlCache.size > 500) {
    const oldestPath = signedUrlCache.keys().next().value;
    if (!oldestPath) break;
    signedUrlCache.delete(oldestPath);
  }
  return urls;
}

async function warmBackend() {
  if (!BASE) return;
  if (backendWarmupRequest) return backendWarmupRequest;
  if (Date.now() - backendHealthyAt < 5 * 60 * 1000) return;
  backendWarmupRequest = (async () => {
    try {
      const stored = JSON.parse(await AsyncStorage.getItem(BACKEND_WARM_KEY) || 'null');
      if (stored?.base === BASE && stored?.at && Date.now() - stored.at >= 0 && Date.now() - stored.at < 5 * 60 * 1000) {
        backendHealthyAt = stored.at;
        return;
      }
    } catch { /* Warm the service if local storage is unavailable. */ }
    const controller = new AbortController();
    // Render free services can take about a minute to wake; this wait stays in
    // the background and lets the health request finish when the service is up.
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(`${BASE}/`, { signal: controller.signal });
      if (response.ok) {
        backendHealthyAt = Date.now();
        void AsyncStorage.setItem(BACKEND_WARM_KEY, JSON.stringify({ base: BASE, at: backendHealthyAt })).catch(() => {});
      }
    } catch { /* The next feature request can retry the health check. */ }
    finally { clearTimeout(timeout); }
  })().finally(() => { backendWarmupRequest = null; });
  return backendWarmupRequest;
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
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, CREATOR_SKILL_KEY]);
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
    throw friendlyServiceError('The service did not respond.');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    const message = typeof msg === 'string' ? msg : JSON.stringify(msg);
    const error = res.status === 429 || res.status >= 500 ? friendlyServiceError(message || `HTTP ${res.status}`) : new Error(message);
    throw Object.assign(error, { status: res.status });
  }
  return data;
}

async function readProject(id: string) {
  const user = await currentUser();
  const cached = await readCachedProject(user.id, id);
  if (cached?.pending) {
    try {
      const { data: remote, error: readError } = await getSupabase().from('projects').select('data,updated_at')
        .eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!readError && remote?.updated_at === cached.remoteUpdatedAt) {
        const { data: saved, error: saveError } = await getSupabase().from('projects').update({
          data: cached.project, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('user_id', user.id).eq('updated_at', cached.remoteUpdatedAt).select('updated_at').maybeSingle();
        if (!saveError && saved?.updated_at) {
          await rememberProject(user.id, cached.project, saved.updated_at);
        }
      } else if (!readError && remote && remote.data?.updated_at === cached.project.updated_at) {
        // The write may have reached Supabase even if its response was lost.
        await rememberProject(user.id, cached.project, remote.updated_at || null);
      } else if (!readError) {
        await rememberProject(user.id, cached.project, cached.remoteUpdatedAt, true, true);
      }
    } catch { /* Keep the local copy until the account service is available. */ }
    const latestCache = await readCachedProject(user.id, id);
    if (latestCache?.pending) return {
      ...latestCache.project, local_recovery: true,
      ...(latestCache.conflict ? { local_sync_conflict: true } : { local_sync_pending: true }),
    };
  }

  let data: any;
  try {
    const result = await getSupabase().from('projects').select('data,updated_at')
      .eq('id', id).eq('user_id', user.id).maybeSingle();
    if (result.error) throw result.error;
    data = result.data;
    if (!data?.data) throw new Error('Project not found');
  } catch (error) {
    if (cached) return {
      ...cached.project,
      local_recovery: true,
      ...(cached.pending ? cached.conflict ? { local_sync_conflict: true } : { local_sync_pending: true } : {}),
    };
    throw friendlyServiceError(error);
  }
  const project = data.data;
  await rememberProject(user.id, project, data.updated_at || project.updated_at || null);
  const assets: { path: string; apply: (url: string | null) => void }[] = [];
  if (project.export?.storage_path) assets.push({ path: project.export.storage_path, apply: (url) => { project.export.url = url; } });
  if (project.soundtrack?.storage_path) assets.push({ path: project.soundtrack.storage_path, apply: (url) => { project.soundtrack.signed_url = url; } });
  if (project.voiceover?.storage_path) assets.push({ path: project.voiceover.storage_path, apply: (url) => { project.voiceover.signed_url = url; } });
  for (const track of (project.edit_json?.tracks || []).filter((value: any) => value.kind === 'overlay')) {
    for (const item of track.items || []) if (item.src) assets.push({ path: item.src, apply: (url) => { item.signed_url = url; } });
  }
  for (const clip of project.clips || []) {
    if (clip.video_storage_path) assets.push({ path: clip.video_storage_path, apply: (url) => { clip.video_url = url; } });
    if (clip.frame_storage_path) assets.push({ path: clip.frame_storage_path, apply: (url) => { clip.frame_url = url; } });
  }
  if (assets.length) {
    try {
      const urlByPath = await signMediaPaths(assets.map((asset) => asset.path));
      for (const asset of assets) asset.apply(urlByPath.get(asset.path) || null);
    } catch {
      // Metadata is still useful when storage is briefly unavailable.
      for (const asset of assets) asset.apply(null);
    }
  }
  return project;
}

async function updateProjectData(project: any) {
  const user = await currentUser();
  const previous = await readCachedProject(user.id, project.id);
  const baseRevision = previous?.remoteUpdatedAt || null;
  const timestamp = new Date(Math.max(Date.now(), (Date.parse(baseRevision || '') || 0) + 1)).toISOString();
  const projectToSave = { ...project, updated_at: timestamp };
  const locallySaved = await rememberProject(user.id, projectToSave, baseRevision, true);
  let update = getSupabase().from('projects').update({ data: withoutTemporaryUrls(projectToSave), updated_at: timestamp })
    .eq('id', project.id).eq('user_id', user.id);
  if (baseRevision) update = update.eq('updated_at', baseRevision) as typeof update;
  let data: any = null;
  let error: any = null;
  try {
    const result = await update.select('updated_at').maybeSingle();
    data = result.data;
    error = result.error;
  } catch (saveError) {
    error = saveError;
  }
  if (error || !data?.updated_at) {
    if (locallySaved) {
      const message = !error
        ? 'This project changed elsewhere. Your latest changes are safe on this device, but could not sync automatically.'
        : 'Your changes are saved on this device. Reopen this project when you are back online to sync them.';
      const offline = new Error(message) as Error & { localSaved?: boolean };
      offline.localSaved = true;
      throw offline;
    }
    throw friendlyServiceError(error || new Error('Could not save this project.'));
  }
  await rememberProject(user.id, projectToSave, data.updated_at);
}

async function createProjectOnce(payload: any) {
  const user = await currentUser();
  const pendingKey = `${PENDING_CREATE_PREFIX}${user.id}`;
  const payloadKey = JSON.stringify(payload);
  let pending: { id: string; payload: string } | null = null;
  try { pending = JSON.parse(await AsyncStorage.getItem(pendingKey) || 'null'); } catch { /* Start a new draft key. */ }
  const id = pending?.payload === payloadKey ? pending.id : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
  try { await AsyncStorage.setItem(pendingKey, JSON.stringify({ id, payload: payloadKey })); } catch { /* In-memory de-duplication still protects this attempt. */ }
  const now = new Date().toISOString();
  const project = {
    id, user_id: user.id, ...payload, status: 'draft', storyboard: null,
    scene_map: null, clips: [], export_url: null, thumbnail_url: null,
    created_at: now, updated_at: now,
  };
  let error: any = null;
  try {
    const result = await getSupabase().from('projects').insert({
      id, user_id: user.id, data: project, created_at: now, updated_at: now,
    });
    error = result.error;
  } catch (insertError) {
    error = insertError;
  }
  if (error) {
    // A retry after a lost response may hit the same row created by the first attempt.
    let existing: any = null;
    try {
      const lookup = await getSupabase().from('projects').select('data,updated_at')
        .eq('id', id).eq('user_id', user.id).maybeSingle();
      if (lookup.error) throw lookup.error;
      existing = lookup.data;
    } catch (lookupError) {
      throw friendlyServiceError(lookupError || error);
    }
    if (!existing?.data) throw friendlyServiceError(error);
    await AsyncStorage.removeItem(pendingKey).catch(() => {});
    await rememberProject(user.id, existing.data, existing.updated_at || null);
    void rememberCreatorStyleChoice(existing.data);
    return existing.data;
  }
  await AsyncStorage.removeItem(pendingKey).catch(() => {});
  await rememberProject(user.id, project, now);
  void rememberCreatorStyleChoice(project);
  return project;
}

async function deleteStoredFrames(paths: string[]) {
  if (!paths.length || !hasSupabaseConfig()) return;
  paths.forEach((path) => signedUrlCache.delete(path));
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
  logBeta('upload', 'started');
  const { error } = await getSupabase().storage.from('project-media').upload(storagePath, bytes, {
    contentType: file.mimeType || 'audio/mpeg', upsert: false,
  });
  if (error) { logBeta('upload', 'failed'); throw error; }
  const oldPath = project[track]?.storage_path;
  const audioTrack = { storage_path: storagePath, title: file.name, content_type: file.mimeType || 'audio/mpeg' };
  try {
    await updateProjectData({ ...project, [track]: audioTrack, updated_at: new Date().toISOString() });
  } catch (updateError) {
    logBeta('upload', 'failed');
    if (!(updateError as any)?.localSaved) await deleteStoredFrames([storagePath]);
    throw updateError;
  }
  logBeta('upload', 'completed');
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
  warmBackend,
  adminAccess: async () => request('/auth/me'),
  adminOverview: async () => request('/admin/overview'),
  adminUsers: async (page = 1) => request(`/admin/users?page=${page}&per_page=20`),
  adminProjects: async (page = 1) => request(`/admin/projects?page=${page}&per_page=20`),
  signup: async (email: string, password: string, name: string) => {
    const creatorSkillLevel = await AsyncStorage.getItem(CREATOR_SKILL_KEY);
    const emailRedirectTo = Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback`
      : Linking.createURL('auth/callback');
    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: {
        data: { name, full_name: name, plan: 'free', creator_skill_level: isCreatorSkillLevel(creatorSkillLevel) ? creatorSkillLevel : 'beginner' },
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
    const savedLevel = data.user.user_metadata?.creator_skill_level;
    if (isCreatorSkillLevel(savedLevel)) {
      await AsyncStorage.setItem(CREATOR_SKILL_KEY, savedLevel);
    } else {
      const localLevel = await AsyncStorage.getItem(CREATOR_SKILL_KEY);
      try {
        const result = await getSupabase().auth.updateUser({ data: { creator_skill_level: isCreatorSkillLevel(localLevel) ? localLevel : 'beginner' } });
        if (result.error) throw result.error;
      } catch (error) {
        console.warn('Could not sync creator level yet:', error);
      }
    }
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
  recommendProjectSettings: (title: string, purpose: string, language: string) => request('/projects/recommendations', {
    method: 'POST', body: JSON.stringify({ title, purpose, language }),
  }),
  createProject: (payload: any) => {
    const key = JSON.stringify(payload);
    const active = pendingProjectCreates.get(key);
    if (active) return active;
    const task = createProjectOnce(payload).finally(() => pendingProjectCreates.delete(key));
    pendingProjectCreates.set(key, task);
    return task;
  },
  listProjects: async (limit = 200) => {
    const user = await currentUser();
    try {
      const { data, error } = await getSupabase().from('projects').select('data,updated_at')
        .eq('user_id', user.id).order('created_at', { ascending: false })
        .limit(Math.max(1, Math.min(200, Math.floor(limit))));
      if (error) throw error;
      const projects = (data || []).map((row: any) => row.data);
      for (const row of (data || []).slice(0, MAX_CACHED_PROJECTS).reverse()) {
        await rememberProject(user.id, row.data, row.updated_at || null);
      }
      return projects;
    } catch (error) {
      const local = await cachedProjects(user.id);
      if (local.length) return local.slice(0, Math.max(1, Math.min(200, Math.floor(limit))));
      throw friendlyServiceError(error);
    }
  },
  getProject: readProject,
  saveEditSettings: async (id: string, settings: Record<string, any>) => {
    const project = await readProject(id);
    const updated = {
      ...project, edit_settings: settings, edit_json: toEditProject(project, settings),
      updated_at: new Date().toISOString(),
    };
    await updateProjectData(updated);
    void rememberCreatorStyleChoice(updated);
    return { ok: true };
  },
  autoEdit: async (id: string, style: string, pacing = 'balanced') => request(`/projects/${id}/auto-edit`, {
    method: 'POST', body: JSON.stringify({ style, pacing }),
  }),
  analyzeMusicBeats: async (id: string) => request(`/projects/${id}/beat-sync`, { method: 'POST' }),
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
      ...(project.edit_json?.tracks || []).flatMap((track: any) => (track.items || []).map((item: any) => item.src)),
    ].filter((path: unknown): path is string => typeof path === 'string' && path.startsWith(projectPrefix));
    const { error } = await getSupabase().from('projects').delete()
      .eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await removeFromProjectIndex(user.id, id);
    await deleteStoredFrames(paths);
    return { ok: true };
  },
  storyboard: async (id: string, force = false) => {
    if (!force) {
      const project = await readProject(id);
      if (project.storyboard?.length) return {
        storyboard: project.storyboard, storyboard_plan: project.storyboard_plan,
        script: project.script || '', ai_generated: project.storyboard_ai_generated,
        preserved_existing: true, cached: true,
      };
    }
    logBeta('storyboard', 'started');
    logBeta('ai_request', 'started');
    try {
      const result = await request(`/projects/${id}/storyboard`, {
        method: 'POST', body: JSON.stringify({ language: await getLanguage() }),
      });
      logBeta('storyboard', 'completed');
      logBeta('ai_request', 'completed');
      const project = await readProject(id).catch(() => null);
      if (project) void rememberCreatorStyleChoice({ ...project, storyboard: result?.storyboard || project.storyboard });
      return result;
    } catch (error) {
      logBeta('storyboard', 'failed');
      logBeta('ai_request', 'failed');
      throw error;
    }
  },
  scan: async (project_id: string, image_base64: string, frames: string[] = []) => {
    logBeta('scan', 'started');
    logBeta('ai_request', 'started');
    try {
      const result = await request('/scan', {
        method: 'POST', body: JSON.stringify({ project_id, frames: frames.length ? frames : [image_base64], language: await getLanguage() }),
      });
      logBeta('scan', 'completed');
      logBeta('ai_request', 'completed');
      return result;
    } catch (error) {
      logBeta('scan', 'failed');
      logBeta('ai_request', 'failed');
      throw error;
    }
  },
  director: async (project_id: string, shot_index: number, image_base64?: string): Promise<DirectorGuidance> => {
    logBeta('ai_request', 'started');
    try {
      const raw = await request('/director/instruct', {
        method: 'POST', body: JSON.stringify({ project_id, shot_index, image_base64, language: await getLanguage() }),
      });
      logBeta('ai_request', 'completed');
      return {
        command: directorCommand(raw), message: String(raw?.instruction || 'Hold camera steady'),
        ready: !!raw?.ready, confidence: Math.max(0, Math.min(100, Number(raw?.confidence) || 0)),
        personalized: raw?.personalized !== false,
      };
    } catch (error) {
      logBeta('ai_request', 'failed');
      throw error;
    }
  },
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
    const frame_storage_path = frame_base64 ? `${prefix}/${stamp}.jpg` : null;
    if (!video.uri && !video.blob) throw new Error('The recorded video is missing. Record the shot again.');
    const inferredMimeType = video.uri?.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
    const mimeType = (video.mimeType || video.blob?.type || inferredMimeType).split(';')[0].trim();
    const extension = mimeType === 'video/webm' ? 'webm' : mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    const video_storage_path = `${prefix}/${stamp}.${extension}`;
    const uploaded: string[] = [];
    logBeta('upload', 'started');
    try {
      const storage = getSupabase().storage.from('project-media');
      const videoBytes = video.blob
        ? video.blob
        : await new (await import('expo-file-system')).File(video.uri!).arrayBuffer();
      const [frameUpload, videoUpload] = await Promise.all([
        frame_storage_path
          ? storage.upload(frame_storage_path, decode(frame_base64), { contentType: 'image/jpeg', upsert: false })
          : Promise.resolve(null),
        storage.upload(video_storage_path, videoBytes, { contentType: mimeType, upsert: false }),
      ]);
      if (frameUpload && !frameUpload.error && frame_storage_path) uploaded.push(frame_storage_path);
      if (!videoUpload.error) uploaded.push(video_storage_path);
      if (frameUpload?.error) throw frameUpload.error;
      if (videoUpload.error) throw videoUpload.error;

      const pendingQuality = {
        overall_score: null, blur_score: null, exposure_score: null, composition_score: null,
        stability_score: null, subject_visible: null, issues: [], recommendation: 'keep',
        review_available: false, review_pending: !!frame_base64,
        reason: frame_base64
          ? 'Your clip is saved. AI is checking the framing in the background.'
          : 'Your clip is saved. This device could not create a review frame, so automatic rating is unavailable.',
      };
      const [project, signedByPath] = await Promise.all([
        readProject(project_id),
        signMediaPaths([...(frame_storage_path ? [frame_storage_path] : []), video_storage_path]),
      ]);
      const clip = {
        shot_index, clip_id: stamp, duration_seconds, quality: pendingQuality,
        brightness: Math.max(-0.5, Math.min(0.5, brightness)), recorded_at: new Date().toISOString(),
        frame_storage_path, video_storage_path,
        frame_url: frame_storage_path ? signedByPath.get(frame_storage_path) || null : null,
        video_url: signedByPath.get(video_storage_path) || null,
      };
      const replacedClips = (project.clips || []).filter((item: any) => item.shot_index === shot_index);
      const clips = [...(project.clips || []).filter((item: any) => item.shot_index !== shot_index), clip];
      clips.sort((a: any, b: any) => a.shot_index - b.shot_index);
      const storyboard = project.storyboard || [];
      if (storyboard[shot_index]) storyboard[shot_index].status = 'captured';
      const savedProject = { ...project, clips, storyboard, status: 'shooting' };
      await updateProjectData(savedProject);
      logBeta('upload', 'completed');
      void deleteStoredFrames(replacedClips.flatMap((item: any) => [item.frame_storage_path, item.video_storage_path]).filter(Boolean));
      onSaved?.(savedProject);

      if (!frame_base64) {
        onReview?.(pendingQuality);
        return pendingQuality;
      }

      // Let the creator move to the next shot while Gemini reviews this frame.
      logBeta('ai_request', 'started');
      void request('/clips/quality', {
          method: 'POST',
          body: JSON.stringify({ project_id, shot_index, frame_base64, duration_seconds, brightness, language, frame_storage_path, video_storage_path }),
        }).then(async (quality) => {
          logBeta('ai_request', 'completed');
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
          logBeta('ai_request', 'failed');
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
      logBeta('upload', 'failed');
      if (!(error as any)?.localSaved) await deleteStoredFrames(uploaded);
      throw error;
    }
  },
  saveSoundtrack: async (project_id: string, file: { uri: string; name: string; mimeType?: string; file?: Blob }) =>
    saveAudioTrack(project_id, 'soundtrack', file),
  removeSoundtrack: async (project_id: string) => removeAudioTrack(project_id, 'soundtrack'),
  saveVoiceover: async (project_id: string, file: { uri: string; name: string; mimeType?: string; file?: Blob }) =>
    saveAudioTrack(project_id, 'voiceover', file),
  removeVoiceover: async (project_id: string) => removeAudioTrack(project_id, 'voiceover'),
  addBrollImage: async (project_id: string, file: { uri: string; name: string; mimeType?: string; file?: Blob; size?: number }, start: number, duration: number) => {
    if (file.size && file.size > 20 * 1024 * 1024) throw new Error('Choose a B-roll image smaller than 20 MB.');
    const user = await currentUser();
    const project = await readProject(project_id);
    const mimeType = file.mimeType || 'image/jpeg';
    if (!mimeType.startsWith('image/')) throw new Error('Choose an image for the B-roll overlay.');
    const extension = (file.name.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1] || (mimeType === 'image/png' ? 'png' : 'jpg')).toLowerCase();
    const path = `${user.id}/${project_id}/broll/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const { File } = await import('expo-file-system');
    const bytes = file.file ? await file.file.arrayBuffer() : await new File(file.uri).arrayBuffer();
    const { error } = await getSupabase().storage.from('project-media').upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) throw error;
    const edit = project.edit_json || toEditProject(project, project.edit_settings || {});
    const overlay = edit.tracks.find((track: any) => track.kind === 'overlay');
    const item: { id: string; type: 'image'; src: string; start: number; duration: number; filter?: undefined;
      frame: { x: number; y: number; width: number; height: number; radius: number }; signed_url?: string | null } = {
      id: `broll-${Date.now()}`, type: 'image', src: path, start: Math.max(0, start), duration: Math.max(0.5, duration), filter: undefined,
      frame: { x: 70, y: 72, width: 38, height: 30, radius: 18 }, signed_url: null,
    };
    overlay.items.push(item);
    try {
      await updateProjectData({ ...project, edit_json: edit, updated_at: new Date().toISOString() });
    } catch (saveError) {
      if (!(saveError as any)?.localSaved) await deleteStoredFrames([path]);
      throw saveError;
    }
    const signed = await signMediaPaths([path]);
    item.signed_url = signed.get(path) || null;
    return item;
  },
  removeBroll: async (project_id: string, itemId: string) => {
    const project = await readProject(project_id);
    const edit = project.edit_json;
    const overlay = edit?.tracks?.find((track: any) => track.kind === 'overlay');
    if (!overlay) return;
    const removed = overlay.items.find((item: any) => item.id === itemId);
    overlay.items = overlay.items.filter((item: any) => item.id !== itemId);
    await updateProjectData({ ...project, edit_json: edit, updated_at: new Date().toISOString() });
    if (removed?.src) await deleteStoredFrames([removed.src]);
  },
  updateStoryboard: async (id: string, shots: any[]) => {
    const project = await readProject(id);
    for (let i = 0; i < shots.length; i++) {
      shots[i].index = i;
      shots[i].status ??= 'pending';
    }
    const updated = { ...project, storyboard: shots, storyboard_user_edited: true, updated_at: new Date().toISOString() };
    await updateProjectData(updated);
    void rememberCreatorStyleChoice(updated);
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
  setShotSkipped: async (id: string, shot_index: number, skipped: boolean) => {
    const project = await readProject(id);
    const storyboard = project.storyboard || [];
    if (storyboard[shot_index]) storyboard[shot_index].status = skipped ? 'skipped' : 'pending';
    await updateProjectData({ ...project, storyboard, updated_at: new Date().toISOString() });
    return { ok: true };
  },
  export: async (
    id: string,
    opts: {
      aspect_ratio?: string; fit_mode?: string; resolution?: string; fps?: number; editing_style?: string;
      clip_order?: number[]; clip_edits?: Record<string, any>[];
      caption_edits?: Record<string, any>[];
      title_text?: string; title_font?: string; title_position?: string;
      title_color?: string; title_size?: string; music_volume?: number; voiceover_volume?: number; original_volume?: number;
      captions_enabled?: boolean; title_animation?: string;
      render_provider?: 'creatomate' | 'ffmpeg';
    } = {},
    onProgress?: (status: string) => void,
  ) => {
    const project = await readProject(id);
    const exportOptions: Record<string, any> = {
      ...(project.edit_settings || {}), ...opts,
      render_provider: opts.render_provider || project.edit_settings?.render_provider || 'ffmpeg', show_shot_titles: false,
      async_export: true,
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
    logBeta('render', 'started');
    logBeta('export', 'started');
    try {
      await warmBackend();
      const result = await request(`/projects/${id}/export`, {
        method: 'POST', body: JSON.stringify(exportOptions),
      });
      if (!result?.job_id) {
        logBeta('render', 'completed');
        logBeta('export', 'completed');
        onProgress?.('completed');
        return result;
      }
      const startedAt = Date.now();
      let waitMs = 1500;
      while (Date.now() - startedAt < 15 * 60_000) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        const endpoint = result.provider === 'ffmpeg' ? 'render-jobs' : 'creatomate-renders';
        let status;
        try {
          status = await request(`/projects/${id}/${endpoint}/${result.job_id}`);
        } catch (error) {
          const code = (error as any)?.status;
          if (code === 401 || code === 403 || code === 404) throw error;
          onProgress?.('Reconnecting to your export…');
          waitMs = 5000;
          continue;
        }
        onProgress?.(status.phase || (status.status === 'FINALIZING' ? 'Saving your finished video…' : 'Rendering your reel…'));
        if (status.status === 'COMPLETED') {
          logBeta('render', 'completed');
          logBeta('export', 'completed');
          onProgress?.('completed');
          return status.export;
        }
        if (status.status === 'FAILED') throw new Error(status.error || 'Could not finish this reel. Your clips are safe; please retry Export.');
        waitMs = Math.min(5000, Math.round(waitMs * 1.35));
      }
      throw new Error('Your export is still running in the background. Your clips are safe; return to Export to check it again.');
    } catch (error) {
      logBeta('render', 'failed');
      logBeta('export', 'failed');
      throw error;
    }
  },
};
