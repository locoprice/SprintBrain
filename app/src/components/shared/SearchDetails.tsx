import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { metadataMatch } from '@/lib/searchIndex';

interface SearchDetailsProps {
  name: string;
  labels: string[];
  keywords?: string[];
  languages?: ReactNode;
  query: string;
  visibleText: string[];
}

const OPEN_EVENT = 'sprintbrain:search-details';

/** Contextual metadata: hover/focus to preview, click or tap to keep it open. */
export function SearchDetails({ name, labels, keywords = [], languages, query, visibleText }: SearchDetailsProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const skipFocus = useRef(false);
  const [mode, setMode] = useState<'preview' | 'pinned' | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const match = metadataMatch(query, visibleText, labels, keywords);

  const cancelTimer = useCallback(() => {
    clearTimeout(timer.current);
  }, []);

  const close = useCallback((restoreFocus = false) => {
    cancelTimer();
    setMode(null);
    if (restoreFocus && document.activeElement !== trigger.current) {
      skipFocus.current = true;
      trigger.current?.focus();
      skipFocus.current = false;
    }
  }, [cancelTimer]);

  function show(next: 'preview' | 'pinned') {
    cancelTimer();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const onTop = below < 260 && above > below;
    setPosition({
      width,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(onTop ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      maxHeight: Math.max(80, onTop ? above : below),
    });
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setMode(next);
  }

  function leave() {
    cancelTimer();
    if (mode === 'preview') {
      timer.current = setTimeout(() => {
        // A pointer leaving must not dismiss a keyboard user's panel.
        if (!trigger.current?.contains(document.activeElement) && !panel.current?.contains(document.activeElement)) {
          setMode(null);
        }
      }, 180);
    }
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!mode) return;
    function outside(event: Event) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(!!panel.current?.contains(document.activeElement));
      }
    }
    function other(event: Event) {
      if ((event as CustomEvent<string>).detail !== id) close();
    }
    function reposition() { close(); }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    document.addEventListener(OPEN_EVENT, other);
    // Close if the anchor moves; scrolling inside the panel stays available.
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener(OPEN_EVENT, other);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', reposition);
    };
  }, [mode, id, close]);

  useEffect(() => {
    if (mode === 'pinned') panel.current?.focus();
  }, [mode]);

  if (!labels.length && !keywords.length && !languages) return null;

  return (
    <span className="inline-flex min-w-0 flex-col items-start">
      <button
        ref={trigger}
        type="button"
        aria-label={`Details for ${name}`}
        aria-haspopup="dialog"
        aria-expanded={!!mode}
        aria-controls={mode ? id : undefined}
        className="min-h-8 rounded-md px-1.5 text-xs font-medium text-ink-muted hover:bg-bg-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onPointerDown={(event) => event.stopPropagation()}
        onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onMouseEnter={() => {
          cancelTimer();
          if (!mode) timer.current = setTimeout(() => show('preview'), 300);
        }}
        onMouseLeave={leave}
        onFocus={() => { if (!mode && !skipFocus.current) show('preview'); }}
        onClick={(event) => {
          event.stopPropagation();
          if (mode === 'pinned') close();
          else show('pinned');
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Tab' && !event.shiftKey && mode) {
            event.preventDefault();
            panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
          }
        }}
      >
        Details
      </button>
      {match && <span className="max-w-full break-words text-xs text-ink-muted">{match.kind}: {match.value}</span>}
      {mode && createPortal(
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={`Details for ${name}`}
          tabIndex={-1}
          style={position}
          className="fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-line bg-card p-4 text-ink shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onMouseEnter={cancelTimer}
          onMouseLeave={leave}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Tab' && event.shiftKey && (
              event.target === panel.current || event.target === panel.current?.querySelector('button')
            )) {
              event.preventDefault();
              close(true);
            }
          }}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="min-w-0 break-words text-sm font-semibold">{name}</p>
            <button type="button" aria-label="Close details" onClick={() => close(true)} className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {([['Labels', labels], ['Search keywords', keywords]] as const).map(([heading, values]) => values.length > 0 && (
            <section key={heading} className="mt-3 first:mt-0" aria-label={heading}>
              <h3 className="mb-1.5 text-xs font-medium text-ink-muted">{heading}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {values.map((value, index) => <li key={`${index}-${value}`} className="max-w-full whitespace-normal break-words rounded-md bg-bg-alt px-2 py-1 text-xs leading-relaxed">{value}</li>)}
              </ul>
            </section>
          ))}
          {languages && (
            <section className="mt-3" aria-label="Languages">
              <h3 className="mb-1.5 text-xs font-medium text-ink-muted">Languages</h3>
              {languages}
            </section>
          )}
        </div>, document.body,
      )}
    </span>
  );
}
