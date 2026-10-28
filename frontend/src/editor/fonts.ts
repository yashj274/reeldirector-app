// Fonts available in the text tool.
// `expoFamily` is the name registered with useFonts from the bundled files.
// `renderFamily` is the Google Fonts family name the cloud renderer uses.
// Keep this list in sync with backend/render_text.py.

import type { FontWeight } from './types';

export interface ReelFont {
  id: string;
  label: string;
  renderFamily: string;
  weights: FontWeight[];
  // expo family name for each weight, e.g. 'Inter_700Bold'
  expoFamily: Partial<Record<FontWeight, string>>;
  category: 'sans' | 'display' | 'serif' | 'script';
}

export const REEL_FONTS: ReelFont[] = [
  {
    id: 'inter', label: 'Clean', renderFamily: 'Inter', category: 'sans',
    weights: [700], expoFamily: { 700: 'Inter_700Bold' },
  },
  {
    id: 'montserrat', label: 'Modern', renderFamily: 'Montserrat', category: 'sans',
    weights: [700], expoFamily: { 700: 'Montserrat_700Bold' },
  },
  {
    id: 'space-grotesk', label: 'Tech', renderFamily: 'Space Grotesk', category: 'sans',
    weights: [700], expoFamily: { 700: 'SpaceGrotesk_700Bold' },
  },
  {
    id: 'bebas', label: 'Title', renderFamily: 'Bebas Neue', category: 'display',
    weights: [400], expoFamily: { 400: 'BebasNeue_400Regular' },
  },
  {
    id: 'anton', label: 'Bold', renderFamily: 'Anton', category: 'display',
    weights: [400], expoFamily: { 400: 'Anton_400Regular' },
  },
  {
    id: 'archivo-black', label: 'Heavy', renderFamily: 'Archivo Black', category: 'display',
    weights: [400], expoFamily: { 400: 'ArchivoBlack_400Regular' },
  },
  {
    id: 'fraunces', label: 'Soft serif', renderFamily: 'Fraunces', category: 'serif',
    weights: [400], expoFamily: { 400: 'Fraunces_400Regular' },
  },
  {
    id: 'playfair', label: 'Elegant', renderFamily: 'Playfair Display', category: 'serif',
    weights: [400], expoFamily: { 400: 'PlayfairDisplay_400Regular' },
  },
  {
    id: 'dm-serif', label: 'Editorial', renderFamily: 'DM Serif Display', category: 'serif',
    weights: [400], expoFamily: { 400: 'DMSerifDisplay_400Regular' },
  },
  {
    id: 'caveat', label: 'Handwritten', renderFamily: 'Caveat', category: 'script',
    weights: [400], expoFamily: { 400: 'Caveat_400Regular' },
  },
  {
    id: 'marker', label: 'Marker', renderFamily: 'Permanent Marker', category: 'script',
    weights: [400], expoFamily: { 400: 'PermanentMarker_400Regular' },
  },
];

export const DEFAULT_FONT_ID = 'inter';

export function getFont(id: string): ReelFont {
  return REEL_FONTS.find((f) => f.id === id) ?? REEL_FONTS[0];
}

/** Closest weight the font actually has. */
export function resolveWeight(font: ReelFont, weight: FontWeight): FontWeight {
  return font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0]);
}

/** Family name to put in a React Native <Text style={{ fontFamily }}>. */
export function expoFontFamily(fontId: string, weight: FontWeight): string {
  const font = getFont(fontId);
  return font.expoFamily[resolveWeight(font, weight)] ?? Object.values(font.expoFamily)[0]!;
}
