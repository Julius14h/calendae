export interface OverlapInput {
  id: string;
  startValue: number;
  endValue: number;
}

export interface OverlapResult {
  lane: number;
  laneCount: number;
}

/**
 * Assigns each interval a lane index plus the total lane count of the cluster
 * it belongs to, so overlapping items can be rendered side by side (like
 * concurrent appointments on the same resource, or overlapping multi-day
 * events on a month-view week row). Values are unit-agnostic — callers pass
 * minutes-since-epoch for the timeline, or day-column indices for the month
 * view.
 */
export function computeOverlapLayout(items: OverlapInput[]): Map<string, OverlapResult> {
  const result = new Map<string, OverlapResult>();
  if (items.length === 0) return result;

  const sorted = [...items].sort((a, b) => a.startValue - b.startValue || a.endValue - b.endValue);

  let clusterItems: OverlapInput[] = [];
  let clusterMaxEnd = -Infinity;

  const flushCluster = () => {
    if (clusterItems.length === 0) return;
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const item of clusterItems) {
      let lane = laneEnds.findIndex((end) => end <= item.startValue);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endValue);
      } else {
        laneEnds[lane] = item.endValue;
      }
      laneOf.set(item.id, lane);
    }
    const laneCount = laneEnds.length;
    for (const item of clusterItems) {
      result.set(item.id, { lane: laneOf.get(item.id)!, laneCount });
    }
    clusterItems = [];
    clusterMaxEnd = -Infinity;
  };

  for (const item of sorted) {
    if (clusterItems.length > 0 && item.startValue >= clusterMaxEnd) {
      flushCluster();
    }
    clusterItems.push(item);
    clusterMaxEnd = Math.max(clusterMaxEnd, item.endValue);
  }
  flushCluster();

  return result;
}
