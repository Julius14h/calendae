import { useEffect, useState } from 'react';
import type { Resource } from './Scheduler.types';
import type { AvailabilityBand } from './utils/availabilityOverlay';
import { dateToX, durationToWidthPx, type TimelineGeometry } from './utils/timeGeometry';
import type { RowLayout } from './utils/rowLayout';
import styles from './AvailabilityOverlay.module.css';

export interface AvailabilityOverlayProps {
  bands: AvailabilityBand[];
  resources: Resource[];
  geometry: TimelineGeometry;
  rowLayout: RowLayout;
}

const LEVEL_CLASS = {
  preferred: styles.preferred,
  available: styles.available,
  unavailable: styles.unavailable,
} as const;

// Matches .band's own fade-out transition duration in the CSS.
const FADE_OUT_MS = 450;

/**
 * Renders the move-target feasibility bands (green/yellow/red) computed by
 * computeAvailabilityBands() as absolutely-positioned, non-interactive
 * rectangles inside the timeline canvas — same coordinate space as
 * ResourceRow/EventBlock, just one layer behind them.
 */
export function AvailabilityOverlay({ bands, resources, geometry, rowLayout }: AvailabilityOverlayProps) {
  // `bands` goes empty the instant highlightEvent is cleared (deselecting),
  // and React would unmount these divs on the very next render — too abrupt
  // for a CSS transition to ever animate, since there'd be no "still present
  // but fading" moment. Holding the last non-empty set here for exactly as
  // long as the fade-out transition takes (then actually clearing) is what
  // gives the removal its own smooth animation instead of a hard cut.
  const [displayedBands, setDisplayedBands] = useState(bands);
  const [exiting, setExiting] = useState(false);
  // Mirrors `bands` purely so the block below can detect "the prop actually
  // changed" — adjusting state in response to that during render (React's
  // documented pattern for this) rather than in an effect avoids an extra
  // committed render for the immediate (non-empty) path.
  const [prevBands, setPrevBands] = useState(bands);
  if (bands !== prevBands) {
    setPrevBands(bands);
    if (bands.length > 0) {
      setDisplayedBands(bands);
      setExiting(false);
    } else if (displayedBands.length > 0) {
      setExiting(true);
    }
  }

  // The fade-out timer itself is a real side effect (subscribing to a
  // platform timer), so it belongs here rather than in the render-phase
  // block above — it only ever calls setState from its (async) callback,
  // never synchronously in the effect body.
  useEffect(() => {
    if (bands.length > 0 || !exiting) return;
    const timeoutId = window.setTimeout(() => setDisplayedBands([]), FADE_OUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [bands, exiting]);

  return (
    <>
      {displayedBands.map((band, i) => {
        const resourceIndex = resources.findIndex((r) => r.id === band.resourceId);
        if (resourceIndex === -1) return null;
        const left = dateToX(band.start, geometry);
        const width = durationToWidthPx(band.start, band.end, geometry);
        const top = rowLayout.offsets[resourceIndex] ?? 0;
        const height = rowLayout.heights[resourceIndex] ?? 0;
        return (
          <div
            key={i}
            className={[styles.band, LEVEL_CLASS[band.level], exiting ? styles.bandExiting : ''].join(' ')}
            style={{ left, width, top, height }}
          />
        );
      })}
    </>
  );
}
