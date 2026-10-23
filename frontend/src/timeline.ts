export type TimelineSegment = { start: number; end: number; playbackRate: number };

export function splitTimelineRange(start: number, end: number, splitPoints: number[]) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= 0.05) return [];
  const cuts = [
    start,
    ...[...new Set(splitPoints.filter(Number.isFinite))]
      .filter((point) => point > start + 0.001 && point < end - 0.001)
      .sort((a, b) => a - b),
    end,
  ];
  return cuts.slice(0, -1).map((segmentStart, index) => ({ start: segmentStart, end: cuts[index + 1] }));
}

export function timelineDuration(segments: TimelineSegment[]) {
  return segments.reduce((total, segment) => {
    const rate = Number.isFinite(segment.playbackRate) && segment.playbackRate > 0 ? segment.playbackRate : 1;
    return total + Math.max(0, segment.end - segment.start) / rate;
  }, 0);
}

export function locateTimelinePosition(segments: TimelineSegment[], timelineTime: number) {
  if (!segments.length) return null;
  const total = timelineDuration(segments);
  let remaining = Math.max(0, Math.min(Number.isFinite(timelineTime) ? timelineTime : 0, total));
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const rate = Number.isFinite(segment.playbackRate) && segment.playbackRate > 0 ? segment.playbackRate : 1;
    const duration = Math.max(0, segment.end - segment.start) / rate;
    const isLast = index === segments.length - 1;
    if (remaining < duration || isLast) {
      return {
        index,
        sourceTime: segment.start + Math.min(duration, remaining) * rate,
      };
    }
    remaining -= duration;
  }
  return null;
}
