import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from '@/routes/DashboardLayout';
import { SnippetsPage } from '@/routes/SnippetsPage';
import { AnalyticsPage } from '@/routes/AnalyticsPage';
import { PromptsPage } from '@/routes/PromptsPage';
import { SettingsPage } from '@/routes/SettingsPage';
import { LoginPage } from '@/routes/LoginPage';
import { AuthCallback } from '@/routes/AuthCallback';
import { AuthGate } from '@/components/auth/AuthGate';
import { DesktopGate } from '@/components/layout/DesktopGate';
import { useIsDesktop } from '@/lib/useViewportGate';

export function App() {
  const isDesktop = useIsDesktop();

  if (!isDesktop) {
    return <DesktopGate />;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public auth routes — no AuthGate, no DashboardLayout */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Protected dashboard routes */}
        <Route
          element={
            <AuthGate>
              <DashboardLayout />
            </AuthGate>
          }
        >
          <Route index element={<SnippetsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Unknown paths inside the SPA fall back to the snippets page. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
