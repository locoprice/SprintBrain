import { CheckCircle2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSettingsStore } from '@/stores/settingsStore';

export function NotionSyncPanel() {
  const sync = useSettingsStore((s) => s.notionSync);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notion sync</CardTitle>
        <CardDescription>
          Mirror your Notion snippet database into SprintBrain. Read-only in this build.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-[12px] border border-line bg-bg-alt px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">
                {sync?.status === 'idle' ? 'Connected' : sync?.status ?? '—'}
              </div>
              <div className="text-xs text-ink-muted">
                Last sync:{' '}
                {sync?.last_sync_at
                  ? format(new Date(sync.last_sync_at), 'PPpp')
                  : 'never'}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" disabled title="Available in next release">
            <RefreshCw className="h-3.5 w-3.5" />
            Force sync
          </Button>
        </div>

        <div className="grid gap-2">
          <label htmlFor="notion-db" className="text-xs font-medium text-ink-muted">
            Notion database ID
          </label>
          <Input
            id="notion-db"
            readOnly
            value={sync?.database_id ?? ''}
            className="font-mono text-xs"
          />
          <p className="text-xs text-ink-subtle">
            Stored encrypted in Supabase. Edit from the extension popup.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
