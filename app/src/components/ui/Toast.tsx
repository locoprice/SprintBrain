import { useEffect } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

// A toast with a button stays up longer: reading the message, deciding, and
// reaching for Undo takes more than the two and a half seconds a plain
// confirmation needs.
const PLAIN_MS = 2500;
const WITH_ACTION_MS = 6000;

export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const clearToast = useUiStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(clearToast, toast.action ? WITH_ACTION_MS : PLAIN_MS);
    return () => window.clearTimeout(id);
  }, [toast, clearToast]);

  if (!toast) return null;

  const action = toast.action;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 flex items-center gap-2.5 rounded-[12px] border bg-card px-4 py-3 text-sm font-semibold shadow-md animate-fade-in ${
        toast.type === 'error'
          ? 'border-danger text-danger'
          : 'border-success text-success'
      }`}
    >
      {toast.type === 'success' ? (
        <Check className="h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0" />
      )}
      {toast.message}
      {action ? (
        <button
          type="button"
          onClick={() => {
            clearToast();
            action.onClick();
          }}
          className="-my-1 ml-1 rounded-[8px] px-2 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary-bg"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
