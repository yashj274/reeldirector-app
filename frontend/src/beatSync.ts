export type BeatSyncClip = {
  shotIndex: number;
  sourceDuration: number;
  edit: {
    included: boolean;
    trim_start_seconds: number;
    trim_end_seconds: number;
    playback_rate: number;
  };
};

/** Suggest non-destructive clip ends near detected music beats. */
export function syncClipEndsToBeats(clips: BeatSyncClip[], beatTimes: number[]) {
  const beats = beatTimes.filter(Number.isFinite).sort((a, b) => a - b);
  let timelineCursor = 0;
  const synced = new Map<number, number>();

  for (const { shotIndex, sourceDuration, edit } of clips) {
    if (!edit.included) continue;
    const rate = Number.isFinite(edit.playback_rate) && edit.playback_rate > 0 ? edit.playback_rate : 1;
    const start = Math.max(0, edit.trim_start_seconds);
    const originalEnd = Math.min(sourceDuration, Math.max(start + 0.5, edit.trim_end_seconds));
    const currentDuration = (originalEnd - start) / rate;
    const sourceLimit = Math.max(0, (sourceDuration - start) / rate);
    const target = timelineCursor + currentDuration;
    const minDuration = Math.max(0.65, currentDuration * 0.65);
    const maxDuration = Math.min(sourceLimit, currentDuration * 1.35);
    const candidates = beats.filter((beat) => beat >= timelineCursor + minDuration
      && beat <= timelineCursor + maxDuration);
    const beat = candidates.reduce<number | null>((closest, value) =>
      closest === null || Math.abs(value - target) < Math.abs(closest - target) ? value : closest, null);

    if (beat !== null) {
      const end = Math.min(sourceDuration, start + (beat - timelineCursor) * rate);
      if (end - start >= 0.5) {
        synced.set(shotIndex, Math.round(end * 100) / 100);
        timelineCursor += (end - start) / rate;
        continue;
      }
    }
    timelineCursor += currentDuration;
  }

  return synced;
}
