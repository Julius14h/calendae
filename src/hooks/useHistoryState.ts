import { useCallback, useState } from 'react'

export const MAX_HISTORY = 100

export interface History<T> {
  present: T
  past: T[]
  future: T[]
}

export function initHistory<T>(present: T): History<T> {
  return { present, past: [], future: [] }
}

/** Pushes `h.present` onto `past`, installs `next` as the new present, and clears `future` — a fresh edit invalidates whatever was previously undone. */
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  return {
    present: next,
    past: [...h.past, h.present].slice(-MAX_HISTORY),
    future: [],
  }
}

/** Replaces `present` in place — `past`/`future` untouched. See `setSilently`'s own doc comment for why this exists alongside `pushHistory`. */
export function setPresentSilently<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next }
}

/** No-op (returns `h` unchanged) if there's nothing to undo. */
export function undoHistory<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  const previous = h.past[h.past.length - 1]
  return {
    present: previous,
    past: h.past.slice(0, -1),
    future: [...h.future, h.present].slice(-MAX_HISTORY),
  }
}

/** No-op (returns `h` unchanged) if there's nothing to redo. */
export function redoHistory<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  const next = h.future[h.future.length - 1]
  return {
    present: next,
    past: [...h.past, h.present].slice(-MAX_HISTORY),
    future: h.future.slice(0, -1),
  }
}

export interface UseHistoryStateResult<T> {
  state: T
  /** Same calling convention as useState's setter (value or updater function) — pushes the current state onto the undo stack and clears redo. */
  set: (updater: T | ((prev: T) => T)) => void
  /** Same calling convention as `set`, but touches only `present` — `past`/`future` are left exactly as they are. For a background update that isn't really an "edit" the user made (e.g. silently backfilling a recurring series as the visible date range changes) — Undo shouldn't have to click through something the user never did. */
  setSilently: (updater: T | ((prev: T) => T)) => void
  undo: () => void
  redo: () => void
  /** Swaps in a fresh state and wipes both stacks — for cases (like loading a save file) where undoing "into" the previous state wouldn't make sense. */
  reset: (next: T) => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * Undo/redo for a single piece of state, as one combined { present, past,
 * future } object updated through a single setState call per operation —
 * deliberately not three separate useState calls (state/past/future), which
 * would need each operation to read the *other* two pieces of state
 * correctly, and is exactly the shape of bug that stale closures cause.
 *
 * `past`/`future` hold state *references*, not deep copies — cheap as long
 * as callers update `state` immutably (spreading/mapping into new
 * arrays/objects rather than mutating in place), which every caller in this
 * app already does.
 */
export function useHistoryState<T>(initial: T): UseHistoryStateResult<T> {
  const [history, setHistory] = useState<History<T>>(() => initHistory(initial))

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    setHistory((h) => {
      const next = typeof updater === 'function' ? (updater as (prev: T) => T)(h.present) : updater
      return pushHistory(h, next)
    })
  }, [])

  const setSilently = useCallback((updater: T | ((prev: T) => T)) => {
    setHistory((h) => {
      const next = typeof updater === 'function' ? (updater as (prev: T) => T)(h.present) : updater
      return setPresentSilently(h, next)
    })
  }, [])

  const undo = useCallback(() => setHistory(undoHistory), [])
  const redo = useCallback(() => setHistory(redoHistory), [])
  const reset = useCallback((next: T) => setHistory(initHistory(next)), [])

  return {
    state: history.present,
    set,
    setSilently,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}
