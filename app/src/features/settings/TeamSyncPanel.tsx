import { useState } from 'react';
import { AlertCircle, Check, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSettingsStore } from '@/stores/settingsStore';

function formatSyncTime(ts: string | null): string {
  if (!ts) return 'Mai sincronizzato';
  try {
    return new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ts));
  } catch {
    return ts;
  }
}

export function TeamSyncPanel() {
  const syncing = useSettingsStore((s) => s.syncing);
  const syncError = useSettingsStore((s) => s.syncError);
  const lastSyncedAt = useSettingsStore((s) => s.lastSyncedAt);
  const syncTeam = useSettingsStore((s) => s.syncTeam);

  const [justSynced, setJustSynced] = useState(false);

  async function onSync() {
    if (syncing) return;
    setJustSynced(false);
    try {
      await syncTeam();
      setJustSynced(true);
      window.setTimeout(() => setJustSynced(false), 3000);
    } catch {
      // syncError is set in the store
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Sincronizzazione Team
        </CardTitle>
        <CardDescription>
          Rendi visibili i tuoi snippet a tutti i membri del team. Finché non sincronizzi,
          i tuoi snippet restano privati e invisibili agli altri.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-[12px] border border-line bg-bg-alt p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-ink-muted">Ultimo sync</div>
              <div className="mt-0.5 text-sm text-ink">{formatSyncTime(lastSyncedAt)}</div>
            </div>
            {lastSyncedAt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                <Check className="h-3 w-3" />
                Sincronizzato
              </span>
            )}
          </div>
        </div>

        {syncError && (
          <div className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{syncError}</span>
          </div>
        )}

        {justSynced && !syncError && (
          <div className="flex items-center gap-2 text-xs text-success">
            <Check className="h-4 w-4" />
            Snippet sincronizzati con il team!
          </div>
        )}

        <Button
          type="button"
          variant="primary"
          onClick={onSync}
          disabled={syncing}
          className="w-full"
        >
          {syncing ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Sincronizzazione in corso…
            </>
          ) : (
            <>
              <Users className="h-4 w-4" />
              Sincronizza Snippet con il Team
            </>
          )}
        </Button>

        <p className="text-xs text-ink-subtle">
          Questa operazione è idempotente: puoi eseguirla ogni volta che aggiungi nuovi snippet.
          I tuoi snippet precedentemente sincronizzati rimangono condivisi.
        </p>
      </CardContent>
    </Card>
  );
}
