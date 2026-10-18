import { useEffect, useState, type RefObject } from 'react';

/**
 * Tracks an element's current `clientWidth`, updating on resize.
 *
 * `ref` objects from `useRef` keep the same identity forever, so `[ref]` in a
 * dependency array never actually changes — a plain `useEffect(() => {...},
 * [ref])` only ever attaches its observer once, to whichever DOM node
 * happened to exist at that first run. If the element the ref points to is
 * later unmounted and a *different* element mounted in its place (e.g. a
 * conditionally-rendered view switching away and back), the observer keeps
 * watching the detached old node and the new one is never observed — the
 * returned width silently freezes forever. `resetKey` lets a caller force
 * the effect to tear down and re-attach whenever that swap happens (pass
 * something that changes exactly when the underlying element is replaced).
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, resetKey?: unknown): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, resetKey]);

  return width;
}
