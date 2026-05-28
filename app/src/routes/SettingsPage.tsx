import { useEffect } from 'react';
import { Activity, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AccountPanel } from '@/features/settings/AccountPanel';
import { InlineTriggerPanel } from '@/features/settings/InlineTriggerPanel';
import { IntegrationsPanel } from '@/features/settings/IntegrationsPanel';
import { NotionSyncPanel } from '@/features/settings/NotionSyncPanel';
import { useSettingsStore } from '@/stores/settingsStore';

export function SettingsPage() {
  const profile = useSettingsStore((s) => s.profile);
  const load = useSettingsStore((s) => s.load);

  useEffect(() => {
    if (!profile) {
      void load();
    }
  }, [load, profile]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your account, sync sources, and connected surfaces."
      />

      <Tabs defaultValue="account" className="w-full">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="notion">Notion sync</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="space-y-4">
          <AccountPanel />
          <InlineTriggerPanel />
        </TabsContent>
        <TabsContent value="notion">
          <NotionSyncPanel />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsPanel />
        </TabsContent>
      </Tabs>

      <a
        href="https://sprintbrain.instatus.com/"
        target="_blank"
        rel="noreferrer"
        className="mt-6 flex items-center justify-between rounded-[12px] border border-line bg-card px-4 py-3 transition-colors hover:border-primary/30 hover:bg-primary-bg"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-alt text-ink-muted">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <span className="text-sm font-semibold text-ink">System Status</span>
            <p className="text-xs text-ink-muted">Real-time uptime and incident reports</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
          <span>sprintbrain.instatus.com</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </div>
      </a>
    </>
  );
}
