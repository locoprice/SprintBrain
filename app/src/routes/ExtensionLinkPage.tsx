import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Chrome } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { SPRINTBRAIN_EXTENSION_IDS } from '@/lib/extensionId';

// AUTH-EXT-002: receives the user's dashboard session and pushes it to the
// SprintBrain Chrome extension via chrome.runtime.sendMessage. The extension's
// manifest.json declares this origin in `externally_connectable.matches`.
//
// Failure modes we surface explicitly:
//  - chrome.runtime not present (user is on Firefox / Safari / no extension)
//  - extension not installed (lastError "Could not establish connection")
//  - no Supabase session (AuthGate should prevent this, defensive)
//  - extension rejected the payload (returned ok: false)

type Status = 'linking' | 'linked' | 'no_chrome' | 'not_installed' | 'error';

interface HandoffPayload {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string | null;
  email: string | null;
}

declare global {
  // Minimal shape — we only call sendMessage from a regular web page.
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (
          extensionId: string,
          message: unknown,
          callback?: (response: { ok?: boolean; error?: string } | undefined) => void,
        ) => void;
        lastError?: { message?: string };
      };
    };
  }
}

export function ExtensionLinkPage() {
  const [status, setStatus] = useState<Status>('linking');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [linkedAs, setLinkedAs] = useState<string | null>(null);

  useEffect(() => {
    void runHandoff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runHandoff() {
    setStatus('linking');
    setErrorMsg(null);

    if (!window.chrome || !window.chrome.runtime || !window.chrome.runtime.sendMessage) {
      setStatus('no_chrome');
      return;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      setStatus('error');
      setErrorMsg(error?.message ?? 'No active session — try signing in again.');
      return;
    }

    const session = data.session;
    const payload: HandoffPayload = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      user_id: session.user?.id ?? null,
      email: session.user?.email ?? null,
    };

    // Try every known extension ID; the first one that responds wins.
    let succeeded = false;
    let lastErr = 'Extension not installed.';
    for (const extId of SPRINTBRAIN_EXTENSION_IDS) {
      const result = await sendToExtension(extId, payload);
      if (result.ok) {
        succeeded = true;
        setLinkedAs(payload.email ?? '(your account)');
        break;
      }
      lastErr = result.error;
    }

    if (succeeded) setStatus('linked');
    else if (/connect|install/i.test(lastErr)) setStatus('not_installed');
    else {
      setStatus('error');
      setErrorMsg(lastErr);
    }
  }

  function sendToExtension(
    extId: string,
    payload: HandoffPayload,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      try {
        window.chrome!.runtime!.sendMessage(
          extId,
          { type: 'session_handoff', session: payload },
          (response) => {
            const lastErr = window.chrome?.runtime?.lastError?.message;
            if (lastErr) {
              resolve({ ok: false, error: lastErr });
              return;
            }
            if (response && response.ok) resolve({ ok: true });
            else resolve({ ok: false, error: response?.error ?? 'Unknown extension error' });
          },
        );
      } catch (e) {
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md rounded-[16px] border border-line bg-card p-8 text-center shadow-md">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary-light text-primary">
          <Chrome className="h-6 w-6" />
        </div>

        {status === 'linking' && (
          <>
            <h1 className="text-lg font-semibold text-ink">Linking the SprintBrain extension…</h1>
            <p className="mt-2 text-sm text-ink-muted">Hang on a moment.</p>
            <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-primary" />
          </>
        )}

        {status === 'linked' && (
          <>
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
            <h1 className="text-lg font-semibold text-ink">Extension linked</h1>
            <p className="mt-2 text-sm text-ink-muted">
              The SprintBrain Chrome extension is now signed in
              {linkedAs ? ` as ${linkedAs}` : ''}.
              <br />You can close this tab.
            </p>
          </>
        )}

        {status === 'no_chrome' && (
          <>
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-warn" />
            <h1 className="text-lg font-semibold text-ink">Open this in Chrome</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Extension linking requires Chrome (or a Chromium browser) with the SprintBrain
              extension installed.
            </p>
          </>
        )}

        {status === 'not_installed' && (
          <>
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-warn" />
            <h1 className="text-lg font-semibold text-ink">SprintBrain extension not detected</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Install the SprintBrain Chrome extension first, then return here to link it.
            </p>
            <Button variant="ghost" className="mt-5" onClick={() => void runHandoff()}>
              Try again
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-danger" />
            <h1 className="text-lg font-semibold text-ink">Linking failed</h1>
            <p className="mt-2 text-sm text-ink-muted">{errorMsg}</p>
            <Button variant="ghost" className="mt-5" onClick={() => void runHandoff()}>
              Try again
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
