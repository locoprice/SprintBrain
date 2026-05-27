import { useEffect } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const clearToast = useUiStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(clearToast, 2500);
    return () => window.clearTimeout(id);
  }, [toast, clearToast]);

  if (!toast) return null;

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
    </div>
  );
}
