export type TextAnimation = 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter' | 'word-by-word';

export const TEXT_STYLES: {
  id: string; label: string; font: string; size: string; color: string;
  position: string; animation: TextAnimation;
}[] = [
  { id: 'clean', label: 'Clean', font: 'inter', size: 'medium', color: 'white', position: 'bottom', animation: 'fade' },
  { id: 'cinematic', label: 'Cinematic', font: 'playfair', size: 'large', color: 'gold', position: 'center', animation: 'fade' },
  { id: 'bold', label: 'Bold', font: 'anton', size: 'large', color: 'white', position: 'center', animation: 'pop' },
  { id: 'modern', label: 'Modern', font: 'montserrat', size: 'medium', color: 'pink', position: 'bottom', animation: 'slide-up' },
  { id: 'editorial', label: 'Editorial', font: 'dm-serif', size: 'large', color: 'white', position: 'top', animation: 'fade' },
  { id: 'handwritten', label: 'Handwritten', font: 'caveat', size: 'large', color: 'gold', position: 'center', animation: 'word-by-word' },
  { id: 'retro', label: 'Retro', font: 'bebas', size: 'large', color: 'pink', position: 'top', animation: 'typewriter' },
  { id: 'tech', label: 'Tech', font: 'space-grotesk', size: 'medium', color: 'white', position: 'center', animation: 'slide-up' },
  { id: 'soft', label: 'Soft', font: 'fraunces', size: 'medium', color: 'gold', position: 'bottom', animation: 'fade' },
  { id: 'marker', label: 'Marker', font: 'marker', size: 'large', color: 'white', position: 'center', animation: 'pop' },
];

export function getTextStyle(id: string) {
  return TEXT_STYLES.find((style) => style.id === id) || TEXT_STYLES[0];
}
