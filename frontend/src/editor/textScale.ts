export const TEXT_SIZE_SCALE = {
  title: { small: 0.042, medium: 0.058, large: 0.074 },
  caption: { small: 0.034, medium: 0.046, large: 0.062 },
} as const;

export function textSizePixels(kind: 'title' | 'caption', size: string, shortSide: number): number {
  const ratio = TEXT_SIZE_SCALE[kind][size as keyof typeof TEXT_SIZE_SCALE[typeof kind]] || TEXT_SIZE_SCALE[kind].medium;
  return Math.max(1, Math.round(shortSide * ratio));
}
