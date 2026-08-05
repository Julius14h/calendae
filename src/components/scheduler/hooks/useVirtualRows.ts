import { useEffect, useState, type RefObject } from 'react';
import { rowIndexAtY, type RowLayout } from '../utils/rowLayout';

export interface VirtualRowsResult {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

/**
 * Windows a list of rows (heights given by `layout`, not necessarily uniform
 * — an expanded row can be taller than the rest) to only what's within (plus
 * overscan of) the container's current scroll viewport, so a resource
 * timeline with hundreds of rows only ever mounts the handful that are visible.
 */
export function useVirtualRows(
  containerRef: RefObject<HTMLElement | null>,
  layout: RowLayout,
  overscan = 4,
): VirtualRowsResult {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => setScrollTop(el.scrollTop);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });

    setViewportHeight(el.clientHeight);
    const resizeObserver = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  const count = layout.heights.length;
  if (count === 0) {
    return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
  }

  const startIndex = Math.max(0, rowIndexAtY(scrollTop, layout) - overscan);
  const endIndex = Math.min(count, rowIndexAtY(scrollTop + viewportHeight, layout) + 1 + overscan);

  const bottomOffset = endIndex < count ? layout.offsets[endIndex] : layout.totalHeight;

  return {
    startIndex,
    endIndex,
    topSpacerHeight: layout.offsets[startIndex],
    bottomSpacerHeight: Math.max(0, layout.totalHeight - bottomOffset),
  };
}
