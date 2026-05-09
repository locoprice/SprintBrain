import { useEffect } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AccountPanel } from '@/features/settings/AccountPanel';
import { IntegrationsPanel } from '@/features/settings/IntegrationsPanel';
import { NotionSyncPanel } from '@/features/settings/NotionSyncPanel';
import { TeamSyncPanel } from '@/features/settings/TeamSyncPanel';
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
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <AccountPanel />
        </TabsContent>
        <TabsContent value="notion">
          <NotionSyncPanel />
        </TabsContent>
        <TabsContent value="team">
          <TeamSyncPanel />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
