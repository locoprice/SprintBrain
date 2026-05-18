import { useEffect, useState } from 'react';
import { AlertCircle, Check, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

type Prefix = '/' | '::' | ';';
const PREFIXES: Prefix[] = ['/', '::', ';'];
const NAME_MAX = 80;

export function AccountPanel() {
  const profile = useSettingsStore((s) => s.profile);
  const editProfile = useSettingsStore((s) => s.editProfile);
  const changeEmail = useSettingsStore((s) => s.changeEmail);

  const [displayName, setDisplayName] = useState('');
  const [prefix, setPrefix] = useState<Prefix>('::');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Change-email sub-form state
  const [emailFormOpen, setEmailFormOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<string | null>(null);

  // Hydrate local form from store when profile lands or changes underneath us.
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name);
    setPrefix(profile.shortcut_prefix);
  }, [profile]);

  // Briefly show "Saved" after a successful write.
  useEffect(() => {
    if (savedAt === null) return;
    const t = window.setTimeout(() => setSavedAt(null), 2000);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const dirty =
    profile !== null &&
    (displayName.trim() !== profile.display_name || prefix !== profile.shortcut_prefix);

  const trimmed = displayName.trim();
  const nameInvalid = trimmed.length === 0 || trimmed.length > NAME_MAX;

  async function onSave() {
    if (!dirty || nameInvalid || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await editProfile({ display_name: trimmed, shortcut_prefix: prefix });
      setSavedAt(Date.now());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function onCancel() {
    if (!profile) return;
    setDisplayName(profile.display_name);
    setPrefix(profile.shortcut_prefix);
    setErrorMsg(null);
  }

  function openEmailForm() {
    setNewEmail('');
    setEmailError(null);
    setEmailSent(null);
    setEmailFormOpen(true);
  }

  function closeEmailForm() {
    setEmailFormOpen(false);
    setNewEmail('');
    setEmailError(null);
  }

  async function onSendEmailChange() {
    if (emailSending) return;
    setEmailSending(true);
    setEmailError(null);
    try {
      await changeEmail(newEmail);
      setEmailSent(newEmail.trim().toLowerCase());
      setEmailFormOpen(false);
      setNewEmail('');
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send verification email');
    } finally {
      setEmailSending(false);
    }
  }

  const newEmailTrimmed = newEmail.trim().toLowerCase();
  const newEmailValid =
    newEmailTrimmed.length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmailTrimmed) &&
    newEmailTrimmed !== (profile?.email ?? '').toLowerCase();

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
            <Input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={NAME_MAX + 1}
              disabled={saving || profile === null}
              placeholder="Your name"
            />
            {nameInvalid && trimmed.length > NAME_MAX && (
              <span className="text-xs text-danger">
                Display name must be {NAME_MAX} characters or fewer.
              </span>
            )}
          </div>
          <div className="grid gap-2">
            <label htmlFor="email" className="text-xs font-medium text-ink-muted">
              Email
            </label>
            <Input id="email" value={profile?.email ?? ''} disabled />
          </div>
        </div>

        {/* Change-email section */}
        {emailSent !== null && (
          <div className="flex items-start gap-2 rounded-[10px] border border-primary/30 bg-primary-bg p-3 text-xs text-primary">
            <Mail className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Verification email sent to <strong>{emailSent}</strong>. Click the link in the email to confirm the change.
            </span>
          </div>
        )}

        {!emailFormOpen ? (
          <button
            type="button"
            onClick={openEmailForm}
            className="text-xs font-medium text-primary hover:text-primary-dark transition-colors"
          >
            Change email address →
          </button>
        ) : (
          <div className="rounded-[12px] border border-line bg-bg-alt p-4 space-y-3">
            <div className="grid gap-2">
              <label htmlFor="new-email" className="text-xs font-medium text-ink-muted">
                New email address
              </label>
              <Input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(e) => {
                  setNewEmail(e.target.value);
                  setEmailError(null);
                }}
                placeholder="new@example.com"
                disabled={emailSending}
                autoFocus
              />
              {emailError && (
                <div className="flex items-start gap-1.5 text-xs text-danger">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{emailError}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={onSendEmailChange}
                disabled={!newEmailValid || emailSending}
              >
                {emailSending ? 'Sending…' : 'Send verification email'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={closeEmailForm}
                disabled={emailSending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div>
          <div className="text-xs font-medium text-ink-muted">Shortcut prefix</div>
          <p className="mt-1 text-xs text-ink-subtle">
            Type this prefix before any trigger to expand a snippet.
          </p>
          <div className="mt-3 inline-flex rounded-[12px] border border-line bg-bg-alt p-1">
            {PREFIXES.map((p) => {
              const isActive = prefix === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPrefix(p)}
                  disabled={saving || profile === null}
                  className={cn(
                    'h-8 min-w-[3rem] rounded-[10px] font-mono text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-card text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink',
                    (saving || profile === null) && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-line pt-4">
          <div className="text-xs text-ink-subtle">
            {savedAt !== null ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Check className="h-3.5 w-3.5" />
                Saved
              </span>
            ) : dirty ? (
              'Unsaved changes'
            ) : (
              'Up to date'
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={!dirty || saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={onSave}
              disabled={!dirty || nameInvalid || saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
