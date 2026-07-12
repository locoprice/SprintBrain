import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * Lightweight timeline engine for the onboarding animation.
 *
 * Ported from the design-tool "omelette" scaffold, stripped down to the
 * primitives a production surface needs: an rAF-driven playhead, easing +
 * interpolation helpers, and a `Sprite` that mounts children only while the
 * playhead is inside its window. The design tool's preview chrome (playback
 * bar, keyboard scrubbing, video-export protocol, font inlining, dark stage,
 * localStorage persistence) is intentionally left out.
 */

export type EaseFn = (t: number) => number;

// Clamp a value to [min, max].
export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

// Easing functions — each maps t ∈ [0,1] to eased t (back may overshoot).
// Declared as explicit properties (not a Record) so member access stays
// non-optional under `noUncheckedIndexedAccess`.
export const Easing = {
  linear: (t: number): number => t,
  easeInQuad: (t: number): number => t * t,
  easeOutQuad: (t: number): number => t * (2 - t),
  easeInOutQuad: (t: number): number =>
    t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: (t: number): number => t * t * t,
  easeOutCubic: (t: number): number => --t * t * t + 1,
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeOutBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/**
 * Popmotion-style piecewise tween: maps `t` across `input` keyframes to the
 * matching `output` values, with optional per-segment easing.
 */
export function interpolate(
  input: number[],
  output: number[],
  ease: EaseFn | EaseFn[] = Easing.linear,
): (t: number) => number {
  return (t: number): number => {
    const n = input.length;
    if (n === 0) return 0;
    if (t <= input[0]!) return output[0]!;
    if (t >= input[n - 1]!) return output[n - 1]!;
    for (let i = 0; i < n - 1; i++) {
      const a = input[i]!;
      const b = input[i + 1]!;
      if (t >= a && t <= b) {
        const span = b - a;
        const local = span === 0 ? 0 : (t - a) / span;
        const easeFn = Array.isArray(ease) ? ease[i] ?? Easing.linear : ease;
        const eased = easeFn(local);
        return output[i]! + (output[i + 1]! - output[i]!) * eased;
      }
    }
    return output[n - 1]!;
  };
}

/** Single-segment tween. Returns `from` before `start`, `to` after `end`. */
export function animate({
  from = 0,
  to = 1,
  start = 0,
  end = 1,
  ease = Easing.easeInOutCubic,
}: {
  from?: number;
  to?: number;
  start?: number;
  end?: number;
  ease?: EaseFn;
}): (t: number) => number {
  return (t: number): number => {
    if (t <= start) return from;
    if (t >= end) return to;
    const local = (t - start) / (end - start);
    return from + (to - from) * ease(local);
  };
}

interface TimelineValue {
  time: number;
  duration: number;
  playing: boolean;
}

const TimelineContext = createContext<TimelineValue>({
  time: 0,
  duration: 10,
  playing: false,
});

export const useTime = (): number => useContext(TimelineContext).time;
export const useTimeline = (): TimelineValue => useContext(TimelineContext);

export interface SpriteValue {
  localTime: number;
  progress: number;
  duration: number;
  visible: boolean;
}

const SpriteContext = createContext<SpriteValue>({
  localTime: 0,
  progress: 0,
  duration: 0,
  visible: true,
});

export const useSprite = (): SpriteValue => useContext(SpriteContext);

interface SpriteProps {
  start?: number;
  end?: number;
  keepMounted?: boolean;
  children: ReactNode | ((v: SpriteValue) => ReactNode);
}

/**
 * Renders children only while the playhead is inside [start, end]. Exposes
 * `localTime` (seconds since start) and `progress` (0..1) via `useSprite()`.
 */
export function Sprite({
  start = 0,
  end = Infinity,
  keepMounted = false,
  children,
}: SpriteProps): ReactElement | null {
  const { time } = useTimeline();
  const visible = time >= start && time <= end;
  if (!visible && !keepMounted) return null;

  const duration = end - start;
  const localTime = Math.max(0, time - start);
  const progress =
    duration > 0 && Number.isFinite(duration)
      ? clamp(localTime / duration, 0, 1)
      : 0;

  const value: SpriteValue = { localTime, progress, duration, visible };

  return (
    <SpriteContext.Provider value={value}>
      {typeof children === 'function' ? children(value) : children}
    </SpriteContext.Provider>
  );
}

interface AnimationStageProps {
  duration: number;
  width?: number;
  height?: number;
  background?: string;
  loop?: boolean;
  autoplay?: boolean;
  showProgress?: boolean;
  progressColor?: string;
  children: ReactNode;
}

/**
 * Fixed-aspect canvas that scales to its container width and drives the
 * playhead. Autoplays and loops by default; unmounting stops the rAF loop.
 */
export function AnimationStage({
  duration,
  width = 1280,
  height = 720,
  background = '#F4F3F1',
  loop = true,
  autoplay = true,
  showProgress = true,
  progressColor = '#1B4FD8',
  children,
}: AnimationStageProps): ReactElement {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [scale, setScale] = useState(1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  // Scale the fixed 1280×720 canvas to the container's current width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (): void => setScale(Math.max(0.05, el.clientWidth / width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  // rAF playhead — advances `time`, loops or stops at `duration`.
  useEffect(() => {
    if (!playing) {
      lastRef.current = null;
      return;
    }
    const step = (ts: number): void => {
      if (lastRef.current == null) lastRef.current = ts;
      // Cap dt so returning to a backgrounded tab (where the browser paused
      // rAF) resumes smoothly instead of jumping the playhead forward.
      const dt = Math.min((ts - lastRef.current) / 1000, 0.05);
      lastRef.current = ts;
      setTime((t) => {
        let next = t + dt;
        if (next >= duration) {
          if (loop) next = next % duration;
          else {
            next = duration;
            setPlaying(false);
          }
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastRef.current = null;
    };
  }, [playing, duration, loop]);

  const ctx = useMemo<TimelineValue>(
    () => ({ time, duration, playing }),
    [time, duration, playing],
  );
  const pct = duration > 0 ? clamp(time / duration, 0, 1) * 100 : 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${width} / ${height}`,
          overflow: 'hidden',
          background,
          borderRadius: 16,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <TimelineContext.Provider value={ctx}>
            {children}
          </TimelineContext.Provider>
        </div>
      </div>
      {showProgress ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 3,
            background: 'rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{ height: '100%', width: `${pct}%`, background: progressColor }}
          />
        </div>
      ) : null}
    </div>
  );
}
