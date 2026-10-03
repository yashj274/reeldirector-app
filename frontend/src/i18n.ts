import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'zh', name: 'Chinese', native: '中文' },
];

const STRINGS: Record<string, Record<string, string>> = {
  en: {
    welcome_back: 'Welcome back', new_reel: 'New Reel', dashboard: 'Home',
    projects: 'Projects', templates: 'Templates', profile: 'Profile',
    start_shooting: 'Start shooting', continue_shooting: 'Continue shooting',
    ai_scan: 'AI scan environment', edit_export: 'Edit video & export',
    render_final: 'Render final reel', reel_ready: 'Your reel is ready!',
    share_reel: 'Share reel',
  },
  hi: {
    welcome_back: 'वापस स्वागत है', new_reel: 'नया रील', dashboard: 'होम',
    projects: 'प्रोजेक्ट्स', templates: 'टेम्पलेट्स', profile: 'प्रोफ़ाइल',
    start_shooting: 'शूटिंग शुरू करें', continue_shooting: 'शूटिंग जारी रखें',
    ai_scan: 'एआई दृश्य स्कैन', edit_export: 'वीडियो एडिट और एक्सपोर्ट',
    render_final: 'अंतिम रील रेंडर करें', reel_ready: 'आपकी रील तैयार है!',
    share_reel: 'रील साझा करें',
  },
  es: {
    welcome_back: 'Bienvenido', new_reel: 'Nuevo Reel', dashboard: 'Inicio',
    projects: 'Proyectos', templates: 'Plantillas', profile: 'Perfil',
    start_shooting: 'Empezar', continue_shooting: 'Continuar',
    ai_scan: 'Escanear con IA', edit_export: 'Editar y exportar',
    render_final: 'Renderizar reel', reel_ready: '¡Tu reel está listo!',
    share_reel: 'Compartir reel',
  },
};

const LANG_KEY = 'reeldirector.language';
const ONBOARD_KEY = 'reeldirector.onboarded';

let currentLang = 'en';

export async function getLanguage(): Promise<string> {
  const v = await AsyncStorage.getItem(LANG_KEY);
  currentLang = v || 'en';
  return currentLang;
}
export async function setLanguage(code: string) {
  currentLang = code;
  await AsyncStorage.setItem(LANG_KEY, code);
}
export async function isOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(ONBOARD_KEY)) === '1';
}
export async function markOnboarded() {
  await AsyncStorage.setItem(ONBOARD_KEY, '1');
}
export function t(key: string): string {
  return STRINGS[currentLang]?.[key] || STRINGS.en[key] || key;
}
export function useT() {
  const [, force] = useState(0);
  useEffect(() => { getLanguage().then(() => force((n) => n + 1)); }, []);
  return t;
}
