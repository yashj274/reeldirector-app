export function shouldAdvanceOnEndEvent(clipHasPlayed = false) {
  return clipHasPlayed;
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
