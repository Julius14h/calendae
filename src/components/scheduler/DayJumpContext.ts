import { createContext } from 'react';

// See DayJumpBar.tsx.
export interface DayJumpApi {
  /** Reported by EventBlock once a press actually becomes a drag (not a plain click), and again when it ends. */
  setDragging: (dragging: boolean) => void;
  /** Whether a pointer position is over the strip — while it is, the drag pauses auto-scroll and placement updates. */
  isOverBar: (clientX: number, clientY: number) => boolean;
}

/** Provided only around Scheduler's own main Week view grid — every other EventBlock (Day/Month views, modals) sees null and behaves as before. */
export const DayJumpContext = createContext<DayJumpApi | null>(null);
