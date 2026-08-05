export interface RowLayout {
  /** Each row's own height, in resource-list order. */
  heights: number[];
  /** Each row's cumulative top offset (heights[i] summed up to but not including i), same order. */
  offsets: number[];
  totalHeight: number;
}

/** Builds cumulative offsets from a list of row heights — the one thing every consumer below needs, since rows are no longer all the same height once one is expanded. */
export function computeRowLayout(heights: number[]): RowLayout {
  const offsets: number[] = new Array(heights.length);
  let top = 0;
  for (let i = 0; i < heights.length; i++) {
    offsets[i] = top;
    top += heights[i];
  }
  return { heights, offsets, totalHeight: top };
}

/**
 * Which row index a given content-relative Y falls into — the variable-height
 * replacement for `Math.floor(y / rowHeight)`. Binary search for the last row
 * whose own offset is still <= y; clamps into range for y outside [0, totalHeight].
 */
export function rowIndexAtY(y: number, layout: RowLayout): number {
  const { offsets } = layout;
  const count = offsets.length;
  if (count === 0) return 0;
  if (y <= 0) return 0;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
