export function shouldAdvanceOnEndEvent(clipHasPlayed: boolean, currentTime: number, clipEnd: number, sourceDuration: number) {
  const end = sourceDuration > 0 ? Math.min(clipEnd, sourceDuration) : clipEnd;
  return clipHasPlayed && Number.isFinite(currentTime) && end > 0 && currentTime >= end - 0.25;
}

export function isClipStartTime(currentTime: number, clipStart: number, clipEnd: number) {
  return Number.isFinite(currentTime) && Number.isFinite(clipStart) && Number.isFinite(clipEnd)
    && clipEnd > clipStart && currentTime >= clipStart - 0.25
    && currentTime <= Math.min(clipEnd, clipStart + 0.5);
}

export function isClipProgress(currentTime: number, clipStart: number, clipEnd: number) {
  return Number.isFinite(currentTime) && Number.isFinite(clipStart) && Number.isFinite(clipEnd)
    && currentTime > clipStart + 0.1 && currentTime < clipEnd - 0.1;
}
