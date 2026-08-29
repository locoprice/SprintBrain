import { useEffect } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The form's public URL. Either the numeric id or the friendly slug works. */
  src: string;
  /** Names the dialog for screen readers and titles the frame. */
  title: string;
}

/**
 * Frames a JotForm so filling one in never costs a page.
 *
 * Generalised from the support-only ContactModal (v2.167.0) when the bug report
 * needed the same treatment. One component, two callers: a second copy would
 * have drifted from this one on the first change to either.
 *
 * An iframe rather than JotForm's `<script src=".../jsform/<id>">` embed. That
 * script builds the form with `document.write`, which React cannot host: it
 * either does nothing after hydration or blows away the document. The iframe
 * renders the same form, needs no third-party script on the page, and keeps the
 * embed unable to read the app's DOM or its session.
 *
 * The dialog pins itself to `data-theme="light"` rather than following the app
 * theme: the embed renders on its own white ground, and a dark frame around a
 * white form reads as a rendering fault. Scoping the attribute here re-declares
 * the light tokens for this subtree only, so every class below still resolves
 * through the design system instead of hard-coded colors.
 */
export function JotFormModal({ open, onClose, src, title }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Mounting only while open keeps the third-party request off every other
  // session: a user who never opens a form never loads one.
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-theme="light"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-[640px] max-w-full animate-fade-in overflow-hidden rounded-[16px] border border-line bg-card shadow-md"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()} form`}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[12px] border border-line bg-card text-ink-subtle transition-colors hover:bg-bg-alt hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
        {/* The embed scrolls inside its own box, so the dialog never outgrows
            the viewport and needs no height-listener script from JotForm. */}
        <iframe
          src={src}
          title={title}
          className="block h-[min(78vh,620px)] w-full border-0 bg-card"
          allow="geolocation; microphone; camera; fullscreen"
        />
      </div>
    </div>
  );
}
