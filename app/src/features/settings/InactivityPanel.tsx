import { useState } from 'react';
import { AlertCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { MAX_MONTHS, MIN_MONTHS } from '@/lib/inactivity';
import { useInactivityMonths } from '@/lib/useInactivityMonths';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

/** 6 to 9, the range the shared rule clamps to on both read and write. */
const MONTH_CHOICES = Array.from(
  { length: MAX_MONTHS - MIN_MONTHS + 1 },
  (_, i) => MIN_MONTHS + i,
);

/**
 * "Unused snippets and prompts" card (INACTIVE-001).
 *
 * The one place this threshold is set. It persists to `user_metadata`, which is
 * also where the Chrome extension reads it, so the popup, the web app and this
 * dashboard all measure staleness the same way. The popup deliberately has no
 * control of its own: it does not write settings (v2.87.0).
 *
 * Applies immediately on pick, like the logo controls rather than the Account
 * name field: there is nothing to mistype and nothing to undo.
 */
export function InactivityPanel() {
  const profile = useSettingsStore((s) => s.profile);
  const editProfile = useSettingsStore((s) => s.editProfile);
  const showToast = useUiStore((s) => s.showToast);
  const months = useInactivityMonths();

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onPick(next: number) {
    if (next === months || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await editProfile({ inactivity_months: next });
      showToast(`Now warning after ${next} months`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || profile === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-warning-deep" aria-hidden />
          Unused snippets and prompts
        </CardTitle>
        <CardDescription>
          A notice appears on the Snippets and Prompts pages when something has not been used for
          this long. Counted from the last expansion, or from the day it was added if it has never
          been used.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <label className="text-xs font-medium text-ink-muted" htmlFor="inactivity-months">
          Warn after
        </label>
        <select
          id="inactivity-months"
          value={months}
          disabled={busy}
          onChange={(e) => void onPick(Number(e.target.value))}
          className={cn(
            'h-9 w-48 rounded-[10px] border border-line bg-card px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
            busy && 'cursor-not-allowed opacity-60',
          )}
        >
          {MONTH_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m} months
            </option>
          ))}
        </select>
        {errorMsg ? (
          <p className="flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {errorMsg}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
