import { describe, expect, it } from 'vitest'
import { initHistory, pushHistory, redoHistory, setPresentSilently, undoHistory } from './useHistoryState'

describe('useHistoryState core transitions', () => {
  it('pushes onto past and clears future on a new edit', () => {
    let h = initHistory('a')
    h = pushHistory(h, 'b')
    expect(h).toEqual({ present: 'b', past: ['a'], future: [] })
  })

  it('undo moves present back and stashes it in future', () => {
    let h = initHistory('a')
    h = pushHistory(h, 'b')
    h = pushHistory(h, 'c')
    h = undoHistory(h)
    expect(h).toEqual({ present: 'b', past: ['a'], future: ['c'] })
  })

  it('redo replays what undo just stashed', () => {
    let h = initHistory('a')
    h = pushHistory(h, 'b')
    h = undoHistory(h)
    h = redoHistory(h)
    expect(h).toEqual({ present: 'b', past: ['a'], future: [] })
  })

  it('a fresh edit after undo discards the redo branch', () => {
    let h = initHistory('a')
    h = pushHistory(h, 'b')
    h = undoHistory(h) // present: 'a', future: ['b']
    h = pushHistory(h, 'z')
    expect(h).toEqual({ present: 'z', past: ['a'], future: [] })
  })

  it('undo/redo are no-ops at the ends of history', () => {
    const h = initHistory('a')
    expect(undoHistory(h)).toBe(h)
    expect(redoHistory(h)).toBe(h)
  })

  it('setPresentSilently replaces present without touching past/future', () => {
    let h = initHistory('a')
    h = pushHistory(h, 'b')
    h = undoHistory(h) // present: 'a', past: [], future: ['b']
    h = setPresentSilently(h, 'a-with-background-fill')
    expect(h).toEqual({ present: 'a-with-background-fill', past: [], future: ['b'] })
    // Redo still replays the SAME 'b' it always would have — the silent
    // update never touched the redo branch, so it isn't lost or altered.
    expect(redoHistory(h)).toEqual({ present: 'b', past: ['a-with-background-fill'], future: [] })
  })
})
