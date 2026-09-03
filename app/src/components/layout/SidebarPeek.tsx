import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { cn } from '@/lib/utils';

/**
 * How far right the pointer may sit before the peek treats it as abandoned:
 * the sidebar's own 260px plus enough slack that clipping the edge on the way
 * past does not snatch the panel away mid-reach.
 */
const LEAVE_AFTER = 300;

/** Brushing the edge in transit should not open it; moving there on purpose should. */
const OPEN_DELAY = 110;

/** Coming back inside this window cancels the close, so a wobble at the boundary cannot flicker it. */
const CLOSE_DELAY = 200;

/**
 * Slide duration. Must stay in step with the `duration-300` class below: it is
 * also how long the panel lingers in the DOM on the way out, and unmounting it
 * early would cut the slide off half-way.
 */
const SLIDE_MS = 300;

/**
 * Hover affordance for the collapsed sidebar.
 *
 * Rendered only while the sidebar is collapsed. A narrow band down the left
 * edge of the canvas opens the sidebar as an overlay when the pointer settles
 * on it, and the panel withdraws once the pointer moves clear. The overlay is
 * positioned against the content row rather than the viewport, so it starts
 * under whatever the topbar and the invite banner currently occupy instead of
 * guessing at their height.
 *
 * Peeking never touches the stored preference: it is a look, not a decision, so
 * the sidebar is still collapsed once the pointer leaves. Pinning it back open
 * is the collapse control's job, in the panel or in the Topbar.
 *
 * The slide is a transition rather than an entrance animation, which is why
 * there are two flags instead of one. `mounted` puts the panel in the DOM at
 * its off-screen position and `slid` then moves it, so the whole sidebar is
 * laid out before anything travels. Doing both at once is what makes a mount
 * animation stutter. The pair run backwards on the way out, so the panel leaves
 * as smoothly as it arrives and is gone from the DOM afterwards rather than
 * sitting off-screen in the tab order.
 */
export function SidebarPeek() {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [slid, setSlid] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pathname } = useLocation();

  const cancelOpen = useCallback(() => {
    if (openTimer.current === null) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  // Into the DOM when wanted, out of it only once the slide-out has finished.
  // Reversing mid-slide is free: the pending unmount is dropped and the panel
  // rides back in from wherever it had got to.
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    setSlid(false);
    const timer = window.setTimeout(() => setMounted(false), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  // Now that the panel is in the DOM at its off-screen position, make the
  // browser resolve that position before moving it. Without this the old and
  // new transforms land in one style pass, there is nothing to travel between,
  // and the panel simply appears. Reading layout is what forces the resolve;
  // requestAnimationFrame would do the same but never fires in a hidden tab.
  useLayoutEffect(() => {
    if (!visible || !mounted) return;
    const node = panelRef.current;
    if (!node) return;
    void node.getBoundingClientRect();
    setSlid(true);
  }, [visible, mounted]);

  // No timer may outlive the component, or it fires setState on an unmounted tree.
  useEffect(() => {
    return () => {
      cancelOpen();
      cancelClose();
    };
  }, [cancelOpen, cancelClose]);

  // Navigating is an answer, so the panel withdraws on its own rather than
  // sitting over the page the user just asked for.
  useEffect(() => {
    cancelOpen();
    cancelClose();
    setVisible(false);
  }, [pathname, cancelOpen, cancelClose]);

  // Distance from the edge is what closes it. Watching the document rather than
  // the panel also covers the pointer that opened the peek and then left
  // without ever entering it.
  useEffect(() => {
    if (!visible) return;

    function onMove(e: MouseEvent) {
      if (e.clientX <= LEAVE_AFTER) {
        cancelClose();
        return;
      }
      if (closeTimer.current !== null) return;
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setVisible(false);
      }, CLOSE_DELAY);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setVisible(false);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visible, cancelClose]);

  function armOpen() {
    if (visible || openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setVisible(true);
    }, OPEN_DELAY);
  }

  return (
    <>
      {/* The band is invisible and the handle inside it is not, so the edge
          advertises that something lives there instead of hiding a secret.
          Pointer-only by design: keyboard users have the Topbar control. */}
      <div
        onMouseEnter={armOpen}
        onMouseLeave={cancelOpen}
        aria-hidden
        className="group absolute inset-y-0 left-0 z-30 flex w-3.5 items-center"
      >
        <span className="h-11 w-[3px] rounded-r-[3px] bg-line transition-colors group-hover:bg-primary" />
      </div>

      {mounted && (
        <div
          ref={panelRef}
          className={cn(
            'absolute inset-y-0 left-0 z-40 shadow-md',
            // Transform and opacity only, so every frame stays on the compositor.
            'transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
            slid ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0',
          )}
        >
          <Sidebar peeked />
        </div>
      )}
    </>
  );
}
