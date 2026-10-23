type StoryboardShot = { status?: string };
type RecordedClip = { shot_index: number | string };

export function nextUnfilmedShotIndex(
  storyboard: StoryboardShot[],
  clips: RecordedClip[],
  currentIndex: number,
): number {
  const savedIndexes = new Set(clips.map((clip) => Number(clip.shot_index)));
  return storyboard.findIndex((shot, index) => index > currentIndex
    && shot.status !== 'skipped'
    && (!savedIndexes.has(index) || shot.status === 'retake'));
}
