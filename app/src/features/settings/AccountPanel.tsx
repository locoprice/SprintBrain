import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

const PREFIXES: Array<'/' | '::' | ';'> = ['/', '::', ';'];

export function AccountPanel() {
  const profile = useSettingsStore((s) => s.profile);
  const setPrefix = useSettingsStore((s) => s.setShortcutPrefix);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>
          Profile and trigger preferences synced across every device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <label htmlFor="name" className="text-xs font-medium text-ink-muted">
              Display name
            </label>
            <Input id="name" defaultValue={profile?.display_name ?? ''} />
          </div>
          <div className="grid gap-2">
            <label htmlFor="email" className="text-xs font-medium text-ink-muted">
              Email
            </label>
            <Input id="email" value={profile?.email ?? ''} disabled />
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-ink-muted">Shortcut prefix</div>
          <p className="mt-1 text-xs text-ink-subtle">
            Type this prefix before any trigger to expand a snippet.
          </p>
          <div className="mt-3 inline-flex rounded-[12px] border border-line bg-bg-alt p-1">
            {PREFIXES.map((p) => {
              const isActive = profile?.shortcut_prefix === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPrefix(p)}
                  className={cn(
                    'h-8 min-w-[3rem] rounded-[10px] font-mono text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-card text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
