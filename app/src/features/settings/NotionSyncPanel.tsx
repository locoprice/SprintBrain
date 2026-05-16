import { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSettingsStore } from '@/stores/settingsStore';

export function NotionSyncPanel() {
  const sync = useSettingsStore((s) => s.notionSync);
  const editNotionSettings = useSettingsStore((s) => s.editNotionSettings);

  const [apiKey, setApiKey] = useState('');
  const [dbId, setDbId] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (sync) {
      setApiKey(sync.api_key ?? '');
      setDbId(sync.database_id ?? '');
    }
  }, [sync?.api_key, sync?.database_id]);

  const isDirty =
    apiKey !== (sync?.api_key ?? '') || dbId !== (sync?.database_id ?? '');

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSavedAt(null);
    try {
      await editNotionSettings({ api_key: apiKey, db_id: dbId });
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const isConnected = Boolean(sync?.api_key && sync?.database_id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notion sync</CardTitle>
        <CardDescription>
          Mirror your Notion snippet database into SprintBrain. Credentials entered here are shared with the extension automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Status row */}
        <div className="flex items-center justify-between rounded-[12px] border border-line bg-bg-alt px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full ${
                isConnected ? 'bg-success/15 text-success' : 'bg-ink-subtle/10 text-ink-muted'
              }`}
            >
              {isConnected ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">
                {sync?.status === 'error'
                  ? 'Sync error'
                  : isConnected
                  ? 'Connected'
                  : 'Not configured'}
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

        {/* API Key */}
        <div className="grid gap-2">
          <label htmlFor="notion-api-key" className="text-xs font-medium text-ink-muted">
            Notion API key
          </label>
          <div className="relative flex items-center">
            <Input
              id="notion-api-key"
              type={showKey ? 'text' : 'password'}
              placeholder="secret_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pr-9 font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2.5 text-ink-muted hover:text-ink"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Database ID */}
        <div className="grid gap-2">
          <label htmlFor="notion-db-id" className="text-xs font-medium text-ink-muted">
            Notion database ID
          </label>
          <Input
            id="notion-db-id"
            placeholder="abc123..."
            value={dbId}
            onChange={(e) => setDbId(e.target.value)}
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Save row */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={saving || (!isDirty && savedAt === null)}
            size="sm"
          >
            {saving ? 'Saving…' : 'Save credentials'}
          </Button>
          {savedAt !== null && !saveError && (
            <span className="text-xs font-medium text-success">Saved</span>
          )}
          {saveError && (
            <span className="text-xs font-medium text-destructive">{saveError}</span>
          )}
        </div>

        <p className="text-xs text-ink-subtle">
          Credentials are stored in your account and synced to the extension automatically.
        </p>
      </CardContent>
    </Card>
  );
}
