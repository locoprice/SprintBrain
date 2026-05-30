import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from '@/routes/DashboardLayout';
import { SnippetsPage } from '@/routes/SnippetsPage';
import { AnalyticsPage } from '@/routes/AnalyticsPage';
import { PromptsPage } from '@/routes/PromptsPage';
import { SettingsPage } from '@/routes/SettingsPage';
import { LoginPage } from '@/routes/LoginPage';
import { SignupPage } from '@/routes/SignupPage';
import { AuthCallback } from '@/routes/AuthCallback';
import { ExtensionLinkPage } from '@/routes/ExtensionLinkPage';
import { AuthGate } from '@/components/auth/AuthGate';
import { DesktopGate } from '@/components/layout/DesktopGate';
import { AuthModalProvider } from '@/context/AuthModalContext';
import { useIsDesktop } from '@/lib/useViewportGate';

export function App() {
  const isDesktop = useIsDesktop();

  // On mobile, only auth routes are served so magic links resolve correctly
  // when opened on a phone. The dashboard itself requires ≥1024px — all
  // non-auth paths fall through to DesktopGate which points to /mobile/.
  if (!isDesktop) {
    return (
      <BrowserRouter>
        <AuthModalProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="*" element={<DesktopGate />} />
          </Routes>
        </AuthModalProvider>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AuthModalProvider>
        <Routes>
          {/* Public auth routes — no AuthGate, no DashboardLayout */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Protected, but renders standalone — no DashboardLayout chrome. */}
          <Route
            path="/extension-link"
            element={
              <AuthGate>
                <ExtensionLinkPage />
              </AuthGate>
            }
          />

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
      </AuthModalProvider>
    </BrowserRouter>
  );
}
