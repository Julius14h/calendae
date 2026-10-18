import { useEffect, useRef, type CSSProperties } from 'react';
import styles from './FlyingChip.module.css';

export interface FlyingChipProps {
  /** The event popover's own on-screen rect at the moment "Unschedule" was clicked — where the flight starts. */
  fromRect: { top: number; left: number; width: number; height: number };
  title: string;
  color: string;
  /** Fired once the flight animation completes — the caller removes this from whatever list is rendering it. */
  onFinish: () => void;
}

/**
 * A one-shot decorative animation: a small chip-shaped clone that flies
 * from `fromRect` into CreateFab's own button (found via its
 * `data-create-fab` attribute) on mount, shrinking and fading out along the
 * way. Purely visual — never gates the real state change (see
 * Scheduler.tsx's own handleEventUnschedule, which fires immediately; this
 * plays alongside it, not before it). Scheduler.tsx separately delays the
 * FAB's own badge count until `onFinish` fires, so the number only ticks up
 * once the chip visually arrives.
 */
export function FlyingChip({ fromRect, title, color, onFinish }: FlyingChipProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Kept in sync via its own effect (never written during render — see
  // this project's react-hooks/refs rule) so the animation effect below can
  // skip `onFinish` in its dependency array. A fresh arrow function every
  // parent render would otherwise restart the animation on every unrelated
  // re-render if `onFinish` were listed directly.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  });

  useEffect(() => {
    const el = ref.current;
    const fab = document.querySelector('[data-create-fab]');
    const fabRect = fab?.getBoundingClientRect();
    if (!el || !fabRect) {
      onFinishRef.current();
      return;
    }

    const fromCenterX = fromRect.left + fromRect.width / 2;
    const fromCenterY = fromRect.top + fromRect.height / 2;
    const toCenterX = fabRect.left + fabRect.width / 2;
    const toCenterY = fabRect.top + fabRect.height / 2;
    const dx = toCenterX - fromCenterX;
    const dy = toCenterY - fromCenterY;

    const animation = el.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.15)`, opacity: 0.15 },
      ],
      { duration: 480, easing: 'cubic-bezier(0.32, 0, 0.4, 1)', fill: 'forwards' },
    );
    const handleFinish = () => onFinishRef.current();
    animation.addEventListener('finish', handleFinish);
    return () => {
      animation.removeEventListener('finish', handleFinish);
      animation.cancel();
    };
  }, [fromRect]);

  return (
    <div
      ref={ref}
      className={styles.chip}
      style={{ top: fromRect.top + fromRect.height / 2, left: fromRect.left + fromRect.width / 2, '--event-color': color } as CSSProperties}
      aria-hidden="true"
    >
      {title}
    </div>
  );
}
