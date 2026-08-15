import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Avada-style tooltip.
 *
 * The values below are the ones Avada actually renders, read off a live
 * theme-fusion tooltip rather than the documentation, which publishes the
 * option list but no CSS:
 *
 *   .tooltip         font-size 12px; line-height 1.4; z-index 2030
 *   .tooltip.in      opacity .9
 *   .tooltip.top     margin-top -3px; padding 5px 0   (the padding is the arrow gap)
 *   .tooltip-inner   max-width 200px; padding 3px 8px; color #D1D1D2;
 *                    background rgba(33,33,33,.97); border-radius 4px;
 *                    text-align center
 *   .tooltip-arrow   5px solid triangle in the same colour
 *   .fade            transition opacity .3s linear
 *
 * Inline values rather than tokens on purpose: this mirrors an external design
 * system exactly, the same reason SnippetsTable.tsx carries the language
 * palette inline. Do not "tokenise" these, they would drift from Avada.
 *
 * Rendered through a portal because every panel that hosts a tooltip scrolls,
 * and an absolutely positioned box inside a scroll container gets clipped.
 */

const TIP_BG = 'rgba(33, 33, 33, 0.97)';
const TIP_FG = 'rgb(209, 209, 210)';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  /** Text shown in the box. Kept short: Avada centres it inside 200px. */
  label: string;
  /** Which side of the trigger the box sits on. Avada defaults to top. */
  placement?: TooltipPlacement;
  /** The element that shows the tooltip on hover or focus. */
  children: ReactNode;
  className?: string;
}

interface Coords {
  left: number;
  top: number;
}

/** Where the box anchors, per placement, in viewport coordinates. */
function anchorFor(rect: DOMRect, placement: TooltipPlacement): Coords {
  switch (placement) {
    case 'bottom':
      return { left: rect.left + rect.width / 2, top: rect.bottom };
    case 'left':
      return { left: rect.left, top: rect.top + rect.height / 2 };
    case 'right':
      return { left: rect.right, top: rect.top + rect.height / 2 };
    default:
      return { left: rect.left + rect.width / 2, top: rect.top };
  }
}

/** Translate + the 3px nudge Avada applies per side. */
const SHIFT: Record<TooltipPlacement, string> = {
  top: 'translate(-50%, -100%) translateY(-3px)',
  bottom: 'translate(-50%, 0) translateY(3px)',
  left: 'translate(-100%, -50%) translateX(-3px)',
  right: 'translate(0, -50%) translateX(3px)',
};

/** The arrow gap, which Avada expresses as padding on the tooltip wrapper. */
const GAP: Record<TooltipPlacement, string> = {
  top: '0 0 5px',
  bottom: '5px 0 0',
  left: '0 5px 0 0',
  right: '0 0 0 5px',
};

/** Triangle pointing back at the trigger. */
function arrowStyle(placement: TooltipPlacement): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderColor: 'transparent',
  };
  switch (placement) {
    case 'bottom':
      return { ...base, top: 0, left: '50%', marginLeft: -5,
        borderWidth: '0 5px 5px', borderBottomColor: TIP_BG };
    case 'left':
      return { ...base, top: '50%', right: 0, marginTop: -5,
        borderWidth: '5px 0 5px 5px', borderLeftColor: TIP_BG };
    case 'right':
      return { ...base, top: '50%', left: 0, marginTop: -5,
        borderWidth: '5px 5px 5px 0', borderRightColor: TIP_BG };
    default:
      return { ...base, bottom: 0, left: '50%', marginLeft: -5,
        borderWidth: '5px 5px 0', borderTopColor: TIP_BG };
  }
}

export function Tooltip({
  label,
  placement = 'top',
  children,
  className,
}: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  // Split from `coords` so the box mounts at opacity 0 and then transitions.
  // Painting it straight in at .9 would skip the fade Avada uses.
  const [visible, setVisible] = useState(false);
  const tipId = useId();

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (el === null) return;
    setCoords(anchorFor(el.getBoundingClientRect(), placement));
  }, [placement]);

  const open = useCallback(() => {
    place();
    setVisible(true);
  }, [place]);

  const close = useCallback(() => setVisible(false), []);

  // Track the trigger every frame while the tooltip is up. Measuring once on
  // open is wrong as soon as anything moves underneath: a scrolling panel, a
  // resize, or the host dialog's own open animation, which owns the transform
  // for a few frames and reports an uncentred rect until it finishes.
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const tick = () => {
      place();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, place]);

  // Escape closes it, matching every other transient layer in the dashboard.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, close]);

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        aria-describedby={visible ? tipId : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
      >
        {children}
      </span>
      {coords !== null &&
        createPortal(
          <div
            id={tipId}
            role="tooltip"
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              transform: SHIFT[placement],
              padding: GAP[placement],
              // Size to the text, not to whatever space is left before the
              // viewport edge. Without this a trigger near the right edge gets
              // a one-word-wide column instead of Avada's 200px box.
              width: 'max-content',
              maxWidth: 200,
              zIndex: 2030,
              fontSize: 12,
              lineHeight: 1.4,
              opacity: visible ? 0.9 : 0,
              transition: 'opacity 0.3s linear',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                maxWidth: 200,
                padding: '3px 8px',
                color: TIP_FG,
                textAlign: 'center',
                backgroundColor: TIP_BG,
                borderRadius: 4,
                backgroundClip: 'padding-box',
              }}
            >
              {label}
            </div>
            <span style={arrowStyle(placement)} />
          </div>,
          document.body,
        )}
    </>
  );
}
