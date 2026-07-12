import type { ReactElement, ReactNode } from 'react';
import {
  AnimationStage,
  Sprite,
  useSprite,
  Easing,
  interpolate,
  clamp,
} from '@/features/onboarding/anim/timeline';

/**
 * SprintBrain onboarding animation — Chrome install → mobile companion
 * (5 steps) → trigger expansion → logo outro. Ported from the imported
 * design (claude.ai/design "SprintBrain Onboarding"); the brand accents were
 * recolored from the source's Iris purple to the shipped Azure primary
 * (design system v1.1). Self-contained illustrative surface: inline styles and
 * fixed 1280×720 coordinates are intrinsic to the piece and don't follow the
 * dashboard's Tailwind-token rule.
 */

/* ─── palette / type ─────────────────────────────────────────── */
const AZURE = '#1B4FD8'; // brand primary (was Iris #6C5CE7)
const AZURE_L = '#3D6FE8'; // gradient endpoint (was Iris-light #8B7CF6)
const AZURE_BG = '#EEF2FF'; // tinted surface (was Iris-bg #F0EDFF)
const AZURE_DK = '#1440B0';
const INK = '#18181B';
const INK_MUT = '#52525B';
const INK_SUB = '#A1A1AA';
const LINE = '#E4E4E7';
const CARD = '#FFFFFF';
const DESK = '#F4F3F1'; // calm warm neutral desk
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = Easing.easeInOutCubic;
const easeOut = Easing.easeOutCubic;
const back = Easing.easeOutBack;

/* ─── brand logo mark (gradient square + white bolt) ─────────── */
function Logo({ size = 44, radius }: { size?: number; radius?: number }): ReactElement {
  const r = radius != null ? radius : Math.round(size * 0.28);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: `linear-gradient(135deg, ${AZURE}, ${AZURE_L})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 6px 18px ${AZURE}44`,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.56}
        height={size * 0.56}
        style={{ display: 'block' }}
      >
        <path
          d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
          fill="#fff"
          stroke="#fff"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/* ─── cursor pointer ─────────────────────────────────────────── */
function Cursor({ x, y, press }: { x: number; y: number; press?: boolean }): ReactElement {
  const s = press ? 0.86 : 1;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 26,
        height: 26,
        transform: `translate(-3px,-2px) scale(${s})`,
        transformOrigin: '3px 3px',
        transition: 'transform 80ms ease',
        pointerEvents: 'none',
        zIndex: 60,
        filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.32))',
      }}
    >
      <svg viewBox="0 0 24 24" width="26" height="26">
        <path
          d="M4 2l6.5 16 2.3-6.7 6.7-2.3L4 2z"
          fill="#fff"
          stroke="#18181B"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function ClickRing({
  x,
  y,
  on,
  t,
}: {
  x: number;
  y: number;
  on: boolean;
  t: number;
}): ReactElement | null {
  if (!on) return null;
  const p = clamp(t / 0.42, 0, 1);
  const r = lerp(4, 26, easeOut(p));
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        border: `2px solid ${AZURE}`,
        opacity: (1 - p) * 0.8,
        pointerEvents: 'none',
        zIndex: 55,
      }}
    />
  );
}

/* touch tap pulse (filled) */
function TapPulse({
  x,
  y,
  on,
  t,
  color = AZURE,
}: {
  x: number;
  y: number;
  on: boolean;
  t: number;
  color?: string;
}): ReactElement | null {
  if (!on) return null;
  const p = clamp(t / 0.5, 0, 1);
  const r = lerp(6, 30, easeOut(p));
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        background: color,
        opacity: (1 - p) * 0.28,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    />
  );
}

/* ─── scene shell: crossfade + gentle push-in camera ─────────── */
function Scene({
  children,
  fadeIn = 0.45,
  fadeOut = 0.4,
  zoom = 0.03,
  bg = DESK,
}: {
  children: ReactNode;
  fadeIn?: number;
  fadeOut?: number;
  zoom?: number;
  bg?: string;
}): ReactElement {
  const { localTime: lt, duration: d } = useSprite();
  let op = 1;
  if (lt < fadeIn) op = easeOut(clamp(lt / fadeIn, 0, 1));
  else if (lt > d - fadeOut) op = easeOut(clamp((d - lt) / fadeOut, 0, 1));
  const sc = lerp(1, 1 + zoom, clamp(lt / d, 0, 1));
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: bg,
        opacity: op,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${sc})`,
          transformOrigin: '50% 46%',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ─── caption (lower third) ──────────────────────────────────── */
function Caption({
  text,
  show,
  t,
  y = 636,
  align = 'center',
  size = 40,
}: {
  text: string;
  show: boolean;
  t: number;
  y?: number;
  align?: 'left' | 'center' | 'right';
  size?: number;
}): ReactElement | null {
  if (!show) return null;
  const p = clamp(t / 0.55, 0, 1);
  const e = easeOut(p);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: y,
        textAlign: align,
        opacity: e,
        transform: `translateY(${lerp(16, 0, e)}px)`,
        zIndex: 40,
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 26, height: 3, borderRadius: 2, background: AZURE }} />
        <span
          style={{
            fontFamily: FONT,
            fontSize: size,
            fontWeight: 600,
            letterSpacing: '-0.5px',
            color: INK,
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════ */
/* SCENE 1 — Chrome Web Store install                            */
/* ════════════════════════════════════════════════════════════ */
function Scene1(): ReactElement {
  const { localTime: lt } = useSprite();
  const bx = 90;
  const by = 60;
  const bw = 1100;
  const cx = interpolate(
    [0, 1.7, 2.4, 3.3, 3.95, 6.8],
    [1010, 900, 900, 1082, 1082, 1082],
    ease,
  )(lt);
  const cy = interpolate(
    [0, 1.7, 2.4, 3.3, 3.95, 6.8],
    [648, 300, 300, 250, 250, 250],
    ease,
  )(lt);
  const clicks = [2.4, 3.95];
  const press = clicks.some((c) => lt >= c && lt < c + 0.14);

  const added = lt >= 2.4;
  const confirmOn = lt >= 2.55 && lt < 4.0;
  const pinned = lt >= 4.05;
  const pinP = clamp((lt - 4.05) / 0.5, 0, 1);
  const toastOn = lt >= 4.15 && lt < 6.6;

  const navBtn = (d: ReactNode): ReactElement => (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#5f6368',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {d}
      </svg>
    </div>
  );

  return (
    <Scene>
      <div
        style={{
          position: 'absolute',
          left: bx,
          top: by,
          width: bw,
          height: 600,
          background: CARD,
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 40px 90px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.08)',
          border: `1px solid ${LINE}`,
        }}
      >
        <div
          style={{
            height: 44,
            background: '#DEE1E6',
            display: 'flex',
            alignItems: 'flex-end',
            padding: '0 10px',
            gap: 6,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#fff',
              height: 34,
              borderRadius: '10px 10px 0 0',
              padding: '0 16px',
              maxWidth: 260,
            }}
          >
            <div
              style={{
                width: 15,
                height: 15,
                borderRadius: 4,
                background: `linear-gradient(135deg,${AZURE},${AZURE_L})`,
              }}
            />
            <span
              style={{
                fontFamily: FONT,
                fontSize: 12.5,
                color: '#3c4043',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              SprintBrain – Chrome Web Store
            </span>
            <span style={{ color: '#80868b', fontSize: 15, marginLeft: 4 }}>×</span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 34,
              borderRadius: '10px 10px 0 0',
              padding: '0 14px',
              color: '#5f6368',
              fontFamily: FONT,
              fontSize: 12.5,
              opacity: 0.7,
            }}
          >
            New tab
          </div>
        </div>
        <div
          style={{
            height: 52,
            background: '#fff',
            borderBottom: `1px solid ${LINE}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: 4,
          }}
        >
          {navBtn(<path d="M15 18l-6-6 6-6" />)}
          {navBtn(<path d="M9 18l6-6-6-6" />)}
          {navBtn(<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />)}
          <div
            style={{
              flex: 1,
              height: 36,
              background: '#F1F3F4',
              borderRadius: 18,
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              margin: '0 10px',
              gap: 8,
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#5f6368" strokeWidth="2">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span style={{ fontFamily: FONT, fontSize: 13.5, color: '#3c4043' }}>
              chromewebstore.google.com/detail/<b style={{ color: INK }}>sprintbrain</b>
            </span>
          </div>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {pinned && (
              <div
                style={{
                  transform: `scale(${back(pinP)})`,
                  filter: pinP < 1 ? `drop-shadow(0 0 10px ${AZURE}88)` : 'none',
                }}
              >
                <Logo size={24} radius={7} />
              </div>
            )}
          </div>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#5f6368',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 12v4a2 2 0 0 1-2 2h-4a1.5 1.5 0 0 1-3 0H6a2 2 0 0 1-2-2v-4a1.5 1.5 0 0 1 0-3V6a2 2 0 0 1 2-2h4a1.5 1.5 0 0 1 3 0h4a2 2 0 0 1 2 2v3" />
            </svg>
          </div>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: `linear-gradient(135deg,${AZURE},${AZURE_DK})`,
              marginLeft: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            L
          </div>
        </div>

        <div style={{ position: 'absolute', top: 96, left: 0, right: 0, bottom: 0, background: '#fff' }}>
          <div
            style={{
              height: 52,
              borderBottom: `1px solid ${LINE}`,
              display: 'flex',
              alignItems: 'center',
              padding: '0 28px',
              gap: 12,
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22">
              <circle cx="12" cy="12" r="9" fill="none" stroke="#1a73e8" strokeWidth="2" />
              <circle cx="12" cy="12" r="3.4" fill="#1a73e8" />
            </svg>
            <span style={{ fontFamily: FONT, fontSize: 17, color: '#3c4043' }}>chrome web store</span>
          </div>
          <div style={{ padding: '44px 56px', display: 'flex', gap: 34, alignItems: 'flex-start' }}>
            <Logo size={104} radius={24} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: INK, letterSpacing: '-0.6px' }}>
                SprintBrain
              </div>
              <div style={{ fontFamily: FONT, fontSize: 14.5, color: '#1a73e8', marginTop: 6 }}>sprintbrain.com</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
                <span style={{ fontFamily: FONT, fontSize: 13.5, color: INK_MUT }}>Featured</span>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: INK_SUB }} />
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: FONT, fontSize: 13.5, color: INK_MUT }}>
                  4.9 <span style={{ color: '#f5a623', letterSpacing: 1 }}>★★★★★</span> (1,204)
                </span>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: INK_SUB }} />
                <span style={{ fontFamily: FONT, fontSize: 13.5, color: INK_MUT }}>Productivity</span>
              </div>
              <div style={{ fontFamily: FONT, fontSize: 15, color: INK_MUT, marginTop: 18, lineHeight: 1.55, maxWidth: 520 }}>
                Type a shortcut, get a full multilingual message. Text expansion built for hospitality teams.
              </div>
            </div>
            <div
              style={{
                height: 48,
                minWidth: 190,
                padding: '0 26px',
                borderRadius: 24,
                background: added ? '#E8EAED' : '#1a73e8',
                color: added ? '#5f6368' : '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontFamily: FONT,
                fontSize: 15,
                fontWeight: 600,
                transform: press && !added ? 'scale(0.97)' : 'scale(1)',
                boxShadow: added ? 'none' : '0 2px 8px rgba(26,115,232,.35)',
                transition: 'transform 80ms ease',
              }}
            >
              {added ? (
                <>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Added to Chrome
                </>
              ) : (
                'Add to Chrome'
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmOn &&
        (() => {
          const p = clamp((lt - 2.55) / 0.28, 0, 1);
          return (
            <div
              style={{
                position: 'absolute',
                left: 918,
                top: 118,
                width: 300,
                background: '#fff',
                borderRadius: 12,
                border: `1px solid ${LINE}`,
                boxShadow: '0 20px 50px rgba(0,0,0,.22)',
                padding: 18,
                zIndex: 50,
                opacity: easeOut(p),
                transform: `translateY(${lerp(-8, 0, easeOut(p))}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Logo size={30} radius={8} />
                <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: INK }}>
                  Add “SprintBrain”?
                </span>
              </div>
              <div style={{ fontFamily: FONT, fontSize: 12.5, color: INK_MUT, lineHeight: 1.5, marginBottom: 16 }}>
                It can read and change your data on sites you use.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <div style={{ padding: '8px 14px', fontFamily: FONT, fontSize: 13.5, color: '#1a73e8', fontWeight: 600 }}>Cancel</div>
                <div style={{ padding: '8px 16px', borderRadius: 8, background: '#1a73e8', color: '#fff', fontFamily: FONT, fontSize: 13.5, fontWeight: 600 }}>
                  Add extension
                </div>
              </div>
            </div>
          );
        })()}

      {toastOn &&
        (() => {
          const p = clamp((lt - 4.15) / 0.3, 0, 1);
          return (
            <div
              style={{
                position: 'absolute',
                left: 830,
                top: 122,
                width: 300,
                background: '#fff',
                borderRadius: 12,
                border: `1px solid ${LINE}`,
                boxShadow: '0 20px 50px rgba(0,0,0,.20)',
                padding: 16,
                zIndex: 48,
                opacity: easeOut(p),
                transform: `translateY(${lerp(-8, 0, easeOut(p))}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Logo size={34} radius={9} />
                <div>
                  <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: INK }}>SprintBrain added</div>
                  <div style={{ fontFamily: FONT, fontSize: 12, color: INK_MUT, marginTop: 2 }}>Pinned to your toolbar ✓</div>
                </div>
              </div>
            </div>
          );
        })()}

      <ClickRing x={cx} y={cy} on={lt >= 2.4 && lt < 2.82} t={lt - 2.4} />
      <ClickRing x={cx} y={cy} on={lt >= 3.95 && lt < 4.37} t={lt - 3.95} />
      <Cursor x={cx} y={cy} press={press} />
      <Caption text="Install once. Works everywhere." show={lt >= 4.6} t={lt - 4.6} />
    </Scene>
  );
}

/* ════════════════════════════════════════════════════════════ */
/* SCENE 2 — Mobile companion, step by step                      */
/* ════════════════════════════════════════════════════════════ */
function LangBadge({ l }: { l: string }): ReactElement {
  const map: Record<string, [string, string]> = {
    EN: ['#EEF2FF', '#1B4FD8'],
    IT: ['#F0FDF4', '#15803D'],
    ES: ['#FFF7ED', '#C2410C'],
    MULTI: ['#F5F3FF', '#7C3AED'],
  };
  const [bg, c] = map[l] ?? map.EN ?? ['#EEF2FF', '#1B4FD8'];
  return (
    <span
      style={{
        background: bg,
        color: c,
        fontSize: 9,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 4,
        textTransform: 'uppercase',
        letterSpacing: '.3px',
        fontFamily: FONT,
      }}
    >
      {l === 'MULTI' ? 'Multi' : l}
    </span>
  );
}

function SnipCard({
  title,
  sc,
  lang,
  hi,
}: {
  title: string;
  sc: string;
  lang: string;
  hi?: boolean;
}): ReactElement {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 18,
        padding: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: hi
          ? `0 0 0 2px ${AZURE}, 0 10px 24px rgba(27,79,216,.18)`
          : '0 1px 3px rgba(0,0,0,.04),0 4px 14px rgba(0,0,0,.04)',
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: '#EEF2FF',
          color: AZURE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: INK, letterSpacing: '-.2px', fontFamily: FONT }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: AZURE, fontWeight: 600 }}>{sc}</span>
          <LangBadge l={lang} />
        </div>
      </div>
      <span style={{ color: INK_SUB, fontSize: 20, fontWeight: 700, marginRight: 4 }}>⋯</span>
    </div>
  );
}

function MobStatus({ dark = true }: { dark?: boolean }): ReactElement {
  const c = dark ? '#1C1C1E' : '#fff';
  return (
    <div
      style={{
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        color: c,
        flexShrink: 0,
        position: 'relative',
        zIndex: 6,
      }}
    >
      <span style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 600 }}>9:41</span>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <svg viewBox="0 0 18 12" width="17" height="11">
          <rect x="1" y="3" width="6" height="7" rx="1" fill="currentColor" />
          <rect x="8" y="1" width="6" height="9" rx="1" fill="currentColor" />
        </svg>
        <div style={{ width: 22, height: 11, border: '1.5px solid currentColor', borderRadius: 3, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 1.5, width: '72%', background: 'currentColor', borderRadius: 1 }} />
        </div>
      </div>
    </div>
  );
}

/* Chrome mobile chrome wrapping a page */
function ChromeMobile({
  url,
  loadP = 1,
  children,
}: {
  url: string;
  loadP?: number;
  children: ReactNode;
}): ReactElement {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <MobStatus dark />
      <div style={{ padding: '2px 10px 8px', position: 'relative' }}>
        <div style={{ height: 36, background: '#F1F3F4', borderRadius: 18, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#5f6368" strokeWidth="2">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span
            style={{
              flex: 1,
              fontFamily: FONT,
              fontSize: 13.5,
              color: INK,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {url}
          </span>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="#5f6368">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </div>
        {loadP < 1 && (
          <div style={{ position: 'absolute', left: 0, bottom: 4, height: 2.5, background: AZURE, width: `${clamp(loadP / 0.6, 0, 1) * 100}%` }} />
        )}
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fff' }}>{children}</div>
    </div>
  );
}

/* ── STEP 1: open + redirect ── */
function RedirectScreen({ t }: { t: number }): ReactElement {
  const loaded = clamp(t / 0.9, 0, 1);
  const url = t < 1.1 ? 'sprintbrain.com' : 'sprintbrain.com/mobile';
  const showRedirect = t >= 0.95;
  return (
    <ChromeMobile url={url} loadP={loaded < 1 ? loaded * 0.6 : 1}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          background: '#fff',
        }}
      >
        <div style={{ opacity: 0.95 }}>
          <Logo size={52} />
        </div>
        {!showRedirect ? (
          <div
            className="animate-spin"
            style={{ width: 30, height: 30, borderRadius: '50%', border: `3px solid ${LINE}`, borderTopColor: AZURE }}
          />
        ) : (
          (() => {
            const p = clamp((t - 0.95) / 0.35, 0, 1);
            return (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: '#EEF2FF',
                  border: '1px solid #BED0FF',
                  color: AZURE,
                  borderRadius: 9999,
                  padding: '8px 16px',
                  fontFamily: FONT,
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: easeOut(p),
                  transform: `translateY(${lerp(6, 0, easeOut(p))}px)`,
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="M13 6l6 6-6 6" />
                </svg>
                Redirecting to mobile view…
              </div>
            );
          })()
        )}
      </div>
    </ChromeMobile>
  );
}

/* ── STEP 2: OTP login ── */
function LoginScreen({ t }: { t: number }): ReactElement {
  const emailStage = t < 1.15;
  const digits = '483921';
  const filled = clamp(Math.floor((t - 1.2) / 0.16), 0, 6);
  const done = t >= 2.35;
  return (
    <ChromeMobile url="sprintbrain.com/mobile">
      <div style={{ position: 'absolute', inset: 0, padding: '26px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#fff' }}>
        <Logo size={54} />
        <div style={{ fontFamily: FONT, fontSize: 20, fontWeight: 800, color: INK, letterSpacing: '-.4px', marginTop: 18 }}>Sign in to SprintBrain</div>
        <div style={{ fontFamily: FONT, fontSize: 13, color: INK_MUT, marginTop: 6, textAlign: 'center' }}>One code signs you in everywhere.</div>

        {emailStage ? (
          <div style={{ width: '100%', marginTop: 26 }}>
            <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: INK_MUT, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Email</div>
            <div style={{ height: 46, border: `1.5px solid ${AZURE}`, boxShadow: '0 0 0 3px rgba(27,79,216,.14)', borderRadius: 10, display: 'flex', alignItems: 'center', padding: '0 14px', fontFamily: FONT, fontSize: 15, color: INK }}>
              team@leibtour.com
            </div>
            <div
              style={{
                marginTop: 14,
                height: 48,
                borderRadius: 12,
                background: AZURE,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONT,
                fontSize: 15,
                fontWeight: 700,
                transform: t > 0.9 ? 'scale(.97)' : 'scale(1)',
                transition: 'transform 80ms',
              }}
            >
              Send code →
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', marginTop: 26, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontFamily: FONT, fontSize: 13, color: INK_MUT, marginBottom: 16 }}>Enter the 6-digit code</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 34,
                    height: 44,
                    borderRadius: 9,
                    border: `1.5px solid ${i < filled ? AZURE : LINE}`,
                    background: i < filled ? '#EEF2FF' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: MONO,
                    fontSize: 20,
                    fontWeight: 700,
                    color: AZURE,
                  }}
                >
                  {i < filled ? digits[i] : ''}
                </div>
              ))}
            </div>
            {done &&
              (() => {
                const p = clamp((t - 2.35) / 0.35, 0, 1);
                return (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 22,
                      color: '#16A34A',
                      fontFamily: FONT,
                      fontSize: 14,
                      fontWeight: 700,
                      opacity: easeOut(p),
                      transform: `scale(${lerp(0.9, 1, back(p))})`,
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Signed in
                  </div>
                );
              })()}
          </div>
        )}
      </div>
    </ChromeMobile>
  );
}

/* ── STEP 3: Add to Home Screen ── */
const MENU: Array<{ t: string; hi?: boolean }> = [
  { t: 'New tab' },
  { t: 'History' },
  { t: 'Downloads' },
  { t: 'Add to Home screen', hi: true },
  { t: 'Share…' },
  { t: 'Settings' },
];

function AddHomeScreen({ t }: { t: number }): ReactElement {
  const sheet = t < 1.5; // Chrome menu phase
  const springP = clamp((t - 1.55) / 0.6, 0, 1); // springboard phase
  const iconPop = clamp((t - 1.85) / 0.55, 0, 1);
  if (sheet) {
    const up = easeOut(clamp(t / 0.4, 0, 1));
    return (
      <ChromeMobile url="sprintbrain.com/mobile">
        {/* faded companion behind */}
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(160deg,${AZURE},${AZURE_DK})`, opacity: 0.5 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.28)' }} />
        {/* bottom sheet menu */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            background: '#fff',
            borderRadius: '18px 18px 0 0',
            padding: '8px 0 14px',
            transform: `translateY(${lerp(100, 0, up)}%)`,
            boxShadow: '0 -8px 30px rgba(0,0,0,.2)',
          }}
        >
          <div style={{ width: 34, height: 4, background: LINE, borderRadius: 2, margin: '6px auto 8px' }} />
          {MENU.map((m) => (
            <div key={m.t} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', background: m.hi ? AZURE_BG : 'transparent' }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.hi ? AZURE : INK_SUB }}>
                {m.hi ? (
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="4" />
                    <path d="M12 8v8" />
                    <path d="M8 12h8" />
                  </svg>
                ) : (
                  <div style={{ width: 15, height: 15, borderRadius: 4, background: '#E4E4E7' }} />
                )}
              </div>
              <span style={{ fontFamily: FONT, fontSize: 14, whiteSpace: 'nowrap', color: m.hi ? AZURE : INK, fontWeight: m.hi ? 700 : 500 }}>{m.t}</span>
            </div>
          ))}
        </div>
        <TapPulse x={80} y={452} on={t > 0.55 && t < 1.2} t={t - 0.55} color={AZURE} />
      </ChromeMobile>
    );
  }
  // springboard
  const tiles = ['#D4D4D8', '#C7D2E8', '#D8CFE8', '#CFE8D6', '#E8D6CF', '#CFE0E8', '#E0CFE8'];
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(200deg,#EDE9FF 0%,#E4ECFF 60%,#EAF3FF 100%)', opacity: easeOut(springP) }}>
      <MobStatus dark />
      <div style={{ textAlign: 'center', marginTop: 24, fontFamily: FONT, color: INK, opacity: 0.85 }}>
        <div style={{ fontSize: 46, fontWeight: 300, letterSpacing: '-2px' }}>9:41</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>Friday, 11 July</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, padding: '0 30px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '22px 20px' }}>
        {tiles.slice(0, 3).map((c, i) => (
          <div key={i}>
            <div style={{ width: 50, height: 50, borderRadius: 13, background: c, boxShadow: '0 4px 10px rgba(0,0,0,.08)' }} />
          </div>
        ))}
        {/* SprintBrain icon pops */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <div style={{ transform: `scale(${back(iconPop)})`, filter: iconPop < 1 ? `drop-shadow(0 0 12px ${AZURE}aa)` : 'none' }}>
            <Logo size={50} radius={13} />
          </div>
          <span style={{ fontFamily: FONT, fontSize: 10, color: INK, fontWeight: 600, opacity: iconPop }}>SprintBrain</span>
        </div>
        {tiles.slice(3).map((c, i) => (
          <div key={i}>
            <div style={{ width: 50, height: 50, borderRadius: 13, background: c, boxShadow: '0 4px 10px rgba(0,0,0,.08)' }} />
          </div>
        ))}
      </div>
      {/* "added" toast */}
      {iconPop > 0.3 && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 120,
            transform: 'translateX(-50%)',
            background: 'rgba(28,28,30,.92)',
            color: '#fff',
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
            padding: '8px 16px',
            borderRadius: 9999,
            opacity: clamp((iconPop - 0.3) / 0.4, 0, 1),
            whiteSpace: 'nowrap',
          }}
        >
          Added to Home screen
        </div>
      )}
      {/* dock */}
      <div
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 20,
          height: 74,
          borderRadius: 26,
          background: 'rgba(255,255,255,.5)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: '0 18px',
        }}
      >
        {['#C7D2E8', '#CFE8D6', '#E8D6CF', '#D8CFE8'].map((c, i) => (
          <div key={i} style={{ width: 48, height: 48, borderRadius: 13, background: c }} />
        ))}
      </div>
    </div>
  );
}

/* ── STEP 4: companion home ── */
function CompanionHome({ scroll = 0 }: { scroll?: number }): ReactElement {
  const quick: Array<[string, boolean]> = [
    ['Prompts', false],
    ['Sync', false],
    ['Snippets', true],
  ];
  const chips: Array<[string, boolean]> = [
    ['All', true],
    ['🇬🇧 EN', false],
    ['🇪🇸 ES', false],
    ['🇮🇹 IT', false],
    ['🌍 Multi', false],
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#F2F2F7', overflow: 'hidden' }}>
      <MobStatus dark={false} />
      <div style={{ position: 'absolute', inset: 0, transform: `translateY(${-scroll}px)` }}>
        <div style={{ padding: '56px 20px 46px', background: `linear-gradient(160deg,${AZURE} 0%,${AZURE_DK} 100%)`, color: '#fff', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -40, top: -40, width: 200, height: 200, background: 'radial-gradient(circle,rgba(255,255,255,.16),transparent 60%)' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontFamily: FONT, fontSize: 13, opacity: 0.78, fontWeight: 500 }}>Welcome</span>
              <span style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, letterSpacing: '-.4px' }}>LeibTour</span>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,.18)', border: '2px solid rgba(255,255,255,.3)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: FONT, fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1 }}>24</span>
            <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 600, opacity: 0.78 }}>snippets</span>
          </div>
        </div>
        <div style={{ padding: '0 16px', marginTop: -22, position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, background: '#fff', borderRadius: 18, padding: '14px 10px', boxShadow: '0 8px 24px rgba(0,0,0,.10)' }}>
            {quick.map(([lbl, on]) => (
              <div key={lbl} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                <div
                  style={{
                    alignSelf: 'stretch',
                    height: 44,
                    borderRadius: 14,
                    background: on ? `linear-gradient(158deg,#4F7FE8,${AZURE_DK})` : 'linear-gradient(158deg,#fff,#EEF2FF)',
                    color: on ? '#fff' : AZURE,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: on ? 'none' : '1px solid rgba(27,79,216,.10)',
                    boxShadow: on ? '0 1px 2px rgba(20,64,176,.35)' : '0 4px 8px rgba(27,79,216,.16)',
                  }}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                  </svg>
                </div>
                <span style={{ fontFamily: FONT, fontSize: 10.5, fontWeight: on ? 700 : 600, color: on ? AZURE : INK }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '18px 16px 8px' }}>
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px 10px 38px', fontFamily: FONT, fontSize: 15, color: INK_SUB, position: 'relative' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#6E6E73" strokeWidth="2.2" style={{ position: 'absolute', left: 12, top: 12 }}>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            Search snippets…
          </div>
        </div>
        <div style={{ padding: '10px 16px 4px', fontFamily: FONT, fontSize: 19, fontWeight: 800, letterSpacing: '-.5px', color: INK }}>All snippets</div>
        <div style={{ display: 'flex', gap: 6, padding: '6px 16px 4px' }}>
          {chips.map(([tt, on]) => (
            <span
              key={tt}
              style={{
                border: `1px solid ${on ? INK : LINE}`,
                background: on ? INK : '#fff',
                color: on ? '#fff' : INK,
                borderRadius: 9999,
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: FONT,
                whiteSpace: 'nowrap',
              }}
            >
              {tt}
            </span>
          ))}
        </div>
        <div style={{ padding: '8px 16px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SnipCard title="Booking Quote" sc="!!quoteEN" lang="EN" />
          <SnipCard title="Preventivo Prenotazione" sc="!!quoteIT" lang="IT" />
          <SnipCard title="Check-in Instructions" sc="!!checkin" lang="MULTI" />
          <SnipCard title="Firma / Signature" sc="!!firm" lang="MULTI" />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          background: 'rgba(16,16,18,.9)',
          backdropFilter: 'blur(18px)',
          borderRadius: 9999,
          padding: 7,
          alignItems: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,.36)',
        }}
      >
        <div style={{ width: 44, height: 44, borderRadius: 9999, background: 'rgba(255,255,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
          </svg>
        </div>
        <div style={{ width: 44, height: 44, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.38)' }}>
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="22" y2="22" />
          </svg>
        </div>
        <div style={{ width: 44, height: 44, borderRadius: 9999, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 3px' }}>
          <Logo size={26} radius={8} />
        </div>
        <div style={{ width: 44, height: 44, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.38)' }}>
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M3 3v18h18" />
            <path d="M7 14l3-4 3 3 4-6" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ── STEP 5: detail page → copy ── */
function DetailScreen({ t }: { t: number }): ReactElement {
  const copied = t >= 1.7;
  const langs: Array<[string, boolean]> = [
    ['EN', true],
    ['IT', false],
    ['ES', false],
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#F2F2F7', display: 'flex', flexDirection: 'column' }}>
      {/* azure header */}
      <div style={{ background: AZURE, color: '#fff', paddingBottom: 12 }}>
        <MobStatus dark={false} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px 0' }}>
          <svg viewBox="0 0 9 16" width="9" height="16" fill="none">
            <path d="M8 1L1 8L8 15" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, letterSpacing: '-.3px', marginLeft: 4 }}>Booking Quote</span>
          <span style={{ marginLeft: 'auto', background: 'rgba(255,255,255,.22)', borderRadius: 5, padding: '3px 7px', fontFamily: FONT, fontSize: 10, fontWeight: 700 }}>EN</span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: INK_MUT, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>Language</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {langs.map(([l, on]) => (
              <div
                key={l}
                style={{
                  flex: 1,
                  minHeight: 56,
                  borderRadius: 14,
                  border: `1.5px solid ${on ? AZURE : LINE}`,
                  background: on ? '#EEF2FF' : '#fff',
                  color: on ? AZURE : INK_MUT,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  fontFamily: FONT,
                  fontWeight: on ? 800 : 600,
                }}
              >
                <span style={{ fontSize: 22 }}>{l === 'EN' ? '🇬🇧' : l === 'IT' ? '🇮🇹' : '🇪🇸'}</span>
                <span style={{ fontSize: 12 }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: INK_MUT, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>Preview</div>
          <div style={{ background: '#fff', borderRadius: 14, padding: 15, boxShadow: '0 1px 3px rgba(0,0,0,.04),0 4px 14px rgba(0,0,0,.04)', fontFamily: FONT, fontSize: 13, lineHeight: 1.6, color: INK }}>
            Dear Marco,
            <br />
            <br />
            Thank you for choosing <b>Villa Aurora</b>. For 12–19 July (7 nights), your total is <b>€4,900</b>, including final cleaning and concierge.
            <br />
            <br />
            Warm regards,
            <br />
            LeibTour
          </div>
        </div>
      </div>
      {/* copy footer */}
      <div style={{ padding: '10px 16px 20px', background: 'rgba(242,242,247,.92)', borderTop: `1px solid ${LINE}` }}>
        <div
          style={{
            height: 52,
            borderRadius: 14,
            background: copied ? '#34C759' : AZURE,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: FONT,
            fontSize: 16,
            fontWeight: 700,
            transform: t > 1.5 && t < 1.7 ? 'scale(.97)' : 'scale(1)',
            transition: 'transform 90ms',
          }}
        >
          {copied ? (
            <>
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Copied ✓
            </>
          ) : (
            <>
              <span style={{ fontSize: 17 }}>📋</span>Copy to clipboard
            </>
          )}
        </div>
      </div>
      <TapPulse x={143} y={548} on={t > 1.35 && t < 1.9} t={t - 1.35} />
    </div>
  );
}

function PhoneShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        width: 306,
        height: 620,
        borderRadius: 46,
        background: '#0D0D0F',
        padding: 10,
        boxShadow: '0 40px 80px rgba(0,0,0,.28), 0 8px 20px rgba(0,0,0,.14)',
        position: 'relative',
      }}
    >
      <div style={{ width: '100%', height: '100%', borderRadius: 37, overflow: 'hidden', background: '#F2F2F7', position: 'relative' }}>{children}</div>
    </div>
  );
}

const STEPS: Array<{ tag: string; h: string; d: string }> = [
  {
    tag: 'OPEN & REDIRECT',
    h: 'Open it in Chrome',
    d: 'Go to sprintbrain.com on your phone. Chrome sees the small screen and sends you straight to the mobile view — /mobile — never the desktop dashboard.',
  },
  {
    tag: 'SIGN IN ONCE',
    h: 'One email code',
    d: 'First visit only: type your email, get a one-time 6-digit code. The session is shared, so the extension, dashboard and mobile all recognise you afterwards.',
  },
  {
    tag: 'PIN A SHORTCUT',
    h: 'Add to Home Screen',
    d: 'In Chrome’s ⋮ menu tap “Add to Home screen.” SprintBrain gets a real home-screen icon that opens full-screen — one tap, no address bar.',
  },
  {
    tag: 'THE HOME SCREEN',
    h: 'Everything in reach',
    d: 'Your snippet count up top; Prompts / Sync / Snippets tiles; a search bar; then folder and language chips (All · EN · ES · IT · Multi) to narrow the list.',
  },
  {
    tag: 'USE A SNIPPET',
    h: 'Tap → pick → copy',
    d: 'Fixed-text snippets copy in one tap. Multilingual or field snippets open a detail page: pick the language, fill fields, check the live preview, then Copy.',
  },
];

function Scene2(): ReactElement {
  const { localTime: lt } = useSprite();
  const B = [0, 2.6, 5.4, 8.2, 10.6, 14.1];
  const F = 0.42;
  const seg = (i: number): number => {
    const s = B[i]!;
    const e = B[i + 1]!;
    if (lt < s - 0.001) return 0;
    if (i !== 4 && lt > e + F) return 0;
    const up = i === 0 ? 1 : clamp((lt - s) / F, 0, 1);
    const down = i === 4 ? 1 : clamp((e + F - lt) / F, 0, 1);
    return easeOut(Math.min(up, down));
  };
  const localT = (i: number): number => lt - B[i]!;
  const homeScroll = interpolate([8.4, 10.6], [0, 96], ease)(clamp(lt, 8.4, 10.6));
  const enter = easeOut(clamp(lt / 0.5, 0, 1));
  const phoneX = 150;
  const phoneY = 46;
  const activeStep = lt < B[1]! ? 0 : lt < B[2]! ? 1 : lt < B[3]! ? 2 : lt < B[4]! ? 3 : 4;

  const screens: ReactElement[] = [
    <RedirectScreen t={localT(0)} />,
    <LoginScreen t={localT(1)} />,
    <AddHomeScreen t={localT(2)} />,
    <CompanionHome scroll={homeScroll} />,
    <DetailScreen t={localT(4)} />,
  ];

  return (
    <Scene zoom={0.015}>
      {/* phone */}
      <div style={{ position: 'absolute', left: phoneX, top: phoneY, transform: `translateY(${lerp(24, 0, enter)}px)`, opacity: enter }}>
        <PhoneShell>
          {screens.map((sc, i) => {
            const o = seg(i);
            if (o <= 0.001) return null;
            return (
              <div key={i} style={{ position: 'absolute', inset: 0, opacity: o }}>
                {sc}
              </div>
            );
          })}
        </PhoneShell>
      </div>

      {/* right-side step explainer */}
      <div style={{ position: 'absolute', left: 530, top: 150, width: 610, height: 420 }}>
        {STEPS.map((st, i) => {
          const o = seg(i);
          if (o <= 0.001) return null;
          const e = o;
          return (
            <div key={i} style={{ position: 'absolute', inset: 0, opacity: e, transform: `translateX(${lerp(26, 0, e)}px)` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: AZURE, letterSpacing: '.5px' }}>
                  STEP {i + 1}
                  <span style={{ color: INK_SUB }}> / 5</span>
                </span>
                <span style={{ width: 22, height: 3, borderRadius: 2, background: AZURE }} />
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: INK_SUB, letterSpacing: '.5px' }}>{st.tag}</span>
              </div>
              <div style={{ fontFamily: FONT, fontSize: 52, fontWeight: 700, color: INK, letterSpacing: '-1.6px', lineHeight: 1.05 }}>{st.h}</div>
              <div style={{ fontFamily: FONT, fontSize: 19, color: INK_MUT, marginTop: 20, lineHeight: 1.55, maxWidth: 500 }}>{st.d}</div>
            </div>
          );
        })}
        {/* progress dots */}
        <div style={{ position: 'absolute', top: 400, left: 2, display: 'flex', gap: 8 }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === activeStep ? 26 : 8,
                height: 8,
                borderRadius: 4,
                background: i === activeStep ? AZURE : LINE,
                transition: 'all .3s ease',
              }}
            />
          ))}
        </div>
      </div>
    </Scene>
  );
}

/* ════════════════════════════════════════════════════════════ */
/* SCENE 3 — Trigger expansion                                   */
/* ════════════════════════════════════════════════════════════ */
const TRIGGER = '!!quoteEN';

function Scene3(): ReactElement {
  const { localTime: lt } = useSprite();
  const cardX = 300;
  const cardY = 118;
  const cardW = 680;

  const typeStart = 0.5;
  const typePer = 0.1;
  const nChars = clamp(Math.floor((lt - typeStart) / typePer), 0, TRIGGER.length);
  const typed = TRIGGER.slice(0, nChars);
  const typing = lt >= typeStart && lt < 2.0;
  const chipOn = lt >= 1.15 && lt < 2.15;
  const fire = lt >= 2.1;
  const exP = clamp((lt - 2.25) / 0.7, 0, 1);
  const zoomP = clamp((lt - 1.9) / 0.6, 0, 1);
  const sc = lerp(1, 1.05, easeOut(zoomP));
  const caret = Math.floor(lt * 2) % 2 === 0;

  return (
    <Scene zoom={0.01}>
      <div style={{ position: 'absolute', left: cardX, top: cardY, width: cardW, transform: `scale(${sc})`, transformOrigin: '40% 30%' }}>
        <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 40px 90px rgba(0,0,0,.16), 0 6px 20px rgba(0,0,0,.08)', border: `1px solid ${LINE}` }}>
          <div style={{ height: 56, borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, background: '#FAFAFA' }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#EDEDF0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontWeight: 700, color: INK_MUT, fontSize: 14 }}>G</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT, fontSize: 14.5, fontWeight: 700, color: INK }}>Reply to guest · Villa Aurora</div>
              <div style={{ fontFamily: FONT, fontSize: 12, color: INK_SUB, marginTop: 1 }}>booking inquiry · 12–19 Jul</div>
            </div>
            <span style={{ color: INK_SUB, fontSize: 18 }}>⋯</span>
          </div>
          <div style={{ padding: '24px 26px', minHeight: 250, fontFamily: FONT, fontSize: 17, color: INK, lineHeight: 1.65 }}>
            <div style={{ color: INK }}>Hi Marco,</div>
            <div style={{ height: 12 }} />
            {!fire ? (
              <div>
                <span style={{ fontFamily: MONO, fontSize: 16.5, fontWeight: 700, color: AZURE, background: AZURE_BG, padding: '1px 4px', borderRadius: 4 }}>{typed}</span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 2,
                    height: 20,
                    background: INK,
                    marginLeft: 1,
                    verticalAlign: '-4px',
                    opacity: caret && typing ? 1 : typing ? 0 : caret ? 1 : 0,
                  }}
                />
              </div>
            ) : (
              <div style={{ opacity: easeOut(exP), transform: `translateY(${lerp(8, 0, easeOut(exP))}px)` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <LangBadge l="EN" />
                  <span style={{ fontFamily: FONT, fontSize: 12, color: INK_SUB, fontWeight: 600 }}>English</span>
                </div>
                <div style={{ fontSize: 15.5, lineHeight: 1.6, color: INK }}>
                  Thank you for choosing <b>Villa Aurora</b>. For 12–19 July (7 nights), your total is <b>€4,900</b>, including final cleaning and concierge. A 30% deposit confirms your dates.
                </div>
                <div style={{ height: 16 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, opacity: easeOut(clamp((lt - 2.7) / 0.6, 0, 1)) }}>
                  <LangBadge l="IT" />
                  <span style={{ fontFamily: FONT, fontSize: 12, color: INK_SUB, fontWeight: 600 }}>Italiano</span>
                </div>
                <div style={{ fontSize: 15.5, lineHeight: 1.6, color: INK, opacity: easeOut(clamp((lt - 2.7) / 0.6, 0, 1)) }}>
                  Grazie per aver scelto <b>Villa Aurora</b>. Dal 12 al 19 luglio (7 notti), il totale è <b>€4.900</b>, incluse pulizie finali e concierge.
                </div>
              </div>
            )}
          </div>
          <div style={{ borderTop: `1px solid ${LINE}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, background: '#FAFAFA' }}>
            <div style={{ height: 40, padding: '0 24px', borderRadius: 10, background: AZURE, color: '#fff', display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT, fontSize: 14.5, fontWeight: 600 }}>
              Send
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </div>
            <span style={{ fontFamily: FONT, fontSize: 12.5, color: INK_SUB }}>Draft saved</span>
          </div>
        </div>

        {chipOn &&
          (() => {
            const p = clamp((lt - 1.15) / 0.22, 0, 1);
            return (
              <div
                style={{
                  position: 'absolute',
                  left: 26,
                  top: 148,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  background: '#fff',
                  border: `1px solid ${AZURE_BG}`,
                  borderRadius: 12,
                  padding: '9px 14px',
                  boxShadow: '0 12px 30px rgba(27,79,216,.22)',
                  opacity: easeOut(p),
                  transform: `translateY(${lerp(6, 0, easeOut(p))}px)`,
                }}
              >
                <Logo size={26} radius={7} />
                <div>
                  <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: INK }}>Booking Quote · EN</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: AZURE, fontWeight: 600 }}>{TRIGGER} → expand</div>
                </div>
                <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: INK_SUB, background: '#F4F4F5', borderRadius: 5, padding: '3px 7px', marginLeft: 4 }}>TAB</span>
              </div>
            );
          })()}
      </div>
      <Caption text="Type less. Say more." show={lt >= 3.1} t={lt - 3.1} y={648} />
    </Scene>
  );
}

/* ════════════════════════════════════════════════════════════ */
/* OUTRO — logo + tagline                                        */
/* ════════════════════════════════════════════════════════════ */
function Outro(): ReactElement {
  const { localTime: lt } = useSprite();
  const lp = clamp(lt / 0.7, 0, 1);
  const wp = clamp((lt - 0.35) / 0.6, 0, 1);
  const tp = clamp((lt - 0.7) / 0.6, 0, 1);
  const uw = clamp((lt - 0.9) / 0.7, 0, 1);
  return (
    <Scene fadeOut={0.5} zoom={0.02} bg="#FFFFFF">
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
        <div style={{ transform: `scale(${back(lp)})`, opacity: clamp(lp * 1.5, 0, 1) }}>
          <Logo size={104} radius={26} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: easeOut(wp), transform: `translateY(${lerp(14, 0, easeOut(wp))}px)` }}>
          <div style={{ fontFamily: FONT, fontSize: 58, fontWeight: 700, color: INK, letterSpacing: '-1.6px' }}>SprintBrain</div>
          <div style={{ height: 4, background: AZURE, borderRadius: 2, marginTop: 12, width: lerp(0, 300, easeOut(uw)) }} />
        </div>
        <div style={{ fontFamily: FONT, fontSize: 22, color: INK_MUT, opacity: easeOut(tp), letterSpacing: '-.2px' }}>Text expansion for hospitality teams.</div>
      </div>
    </Scene>
  );
}

/* ════════════════════════════════════════════════════════════ */
export function OnboardingAnimation(): ReactElement {
  return (
    <AnimationStage duration={27} background={DESK}>
      <Sprite start={0} end={6.9}>
        <Scene1 />
      </Sprite>
      <Sprite start={6.9} end={21.0}>
        <Scene2 />
      </Sprite>
      <Sprite start={21.0} end={25.9}>
        <Scene3 />
      </Sprite>
      <Sprite start={25.9} end={27}>
        <Outro />
      </Sprite>
    </AnimationStage>
  );
}
