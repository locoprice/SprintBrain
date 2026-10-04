import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AccountPanel } from '@/features/settings/AccountPanel';
import { BrandingPanel } from '@/features/settings/BrandingPanel';
import { InactivityPanel } from '@/features/settings/InactivityPanel';
import { InlineTriggerPanel } from '@/features/settings/InlineTriggerPanel';
import { IntegrationsPanel } from '@/features/settings/IntegrationsPanel';
import { NotionSyncPanel } from '@/features/settings/NotionSyncPanel';
import { PasswordPanel } from '@/features/settings/PasswordPanel';
import { SecurityPanel } from '@/features/settings/SecurityPanel';
import { useSettingsStore } from '@/stores/settingsStore';

const TABS = ['account', 'security', 'notion', 'integrations'] as const;

export function SettingsPage() {
  const profile = useSettingsStore((s) => s.profile);
  const load = useSettingsStore((s) => s.load);
  // ?tab=security opens straight on that tab (the password reset link lands there).
  const [params] = useSearchParams();
  const requestedTab = params.get('tab');
  const initialTab = TABS.find((t) => t === requestedTab) ?? 'account';

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

      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notion">Notion sync</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="space-y-4">
          <AccountPanel />
          <BrandingPanel />
          <InlineTriggerPanel />
          <InactivityPanel />
        </TabsContent>
        <TabsContent value="security" className="space-y-4">
          <PasswordPanel />
          <SecurityPanel />
        </TabsContent>
        <TabsContent value="notion">
          <NotionSyncPanel />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
