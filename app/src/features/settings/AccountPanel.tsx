import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Check, ImagePlus, Mail, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { IMAGE_INPUT_ACCEPT, validateImageFile } from '@/lib/branding';
import { useOrgStore } from '@/stores/orgStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

const NAME_MAX = 80;

export function AccountPanel() {
  const profile = useSettingsStore((s) => s.profile);
  const editProfile = useSettingsStore((s) => s.editProfile);
  const changeEmail = useSettingsStore((s) => s.changeEmail);
  const setAvatar = useSettingsStore((s) => s.setAvatar);
  const clearAvatar = useSettingsStore((s) => s.clearAvatar);
  const showToast = useUiStore((s) => s.showToast);

  const activeOrg = useOrgStore((s) => s.activeOrg);
  const orgLoading = useOrgStore((s) => s.loading);
  const orgError = useOrgStore((s) => s.error);
  const loadOrg = useOrgStore((s) => s.load);

  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Profile-photo upload state
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Change-email sub-form state
  const [emailFormOpen, setEmailFormOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<string | null>(null);

  // The Team row reads the active org; load() is lazy and idempotent, so
  // personal-only accounts pay one cheap RLS-scoped query and see "No team yet".
  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);

  // Hydrate local form from store when profile lands or changes underneath us.
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name);
  }, [profile]);

  // Briefly show "Saved" after a successful write.
  useEffect(() => {
    if (savedAt === null) return;
    const t = window.setTimeout(() => setSavedAt(null), 2000);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const dirty =
    profile !== null &&
    displayName.trim() !== profile.display_name;

  const trimmed = displayName.trim();
  const nameInvalid = trimmed.length === 0 || trimmed.length > NAME_MAX;

  const avatarUrl = profile?.avatar_url ?? null;
  const initial = (profile?.display_name ?? 'A').slice(0, 1).toUpperCase();
  const avatarBusy = uploading || removing || profile === null;
  const memberSince = profile ? format(new Date(profile.created_at), 'MMM d, yyyy') : '—';

  async function onSave() {
    if (!dirty || nameInvalid || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await editProfile({ display_name: trimmed });
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
    setErrorMsg(null);
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after an error
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      setErrorMsg(invalid);
      return;
    }
    setUploading(true);
    setErrorMsg(null);
    try {
      await setAvatar(file);
      showToast('Photo updated');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onRemovePhoto() {
    if (removing) return;
    setRemoving(true);
    setErrorMsg(null);
    try {
      await clearAvatar();
      showToast('Photo removed');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setRemoving(false);
    }
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
          Profile photo, display name, and email — synced across every device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Profile photo — round preview with initial fallback */}
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Profile photo"
              draggable={false}
              className="h-16 w-16 shrink-0 rounded-full border border-line object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-light text-xl font-bold text-primary">
              {initial}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_INPUT_ACCEPT}
            onChange={onPickPhoto}
            className="hidden"
            aria-label="Upload profile photo"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {uploading ? 'Uploading…' : avatarUrl ? 'Replace photo' : 'Upload photo'}
            </Button>
            {avatarUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemovePhoto}
                disabled={avatarBusy}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {removing ? 'Removing…' : 'Remove'}
              </Button>
            )}
          </div>
        </div>

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
              Verification email sent to <strong>{emailSent}</strong>. Open it and click <strong>Change Email</strong> to confirm — the dashboard will refresh automatically once the change is applied.
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

        {errorMsg && (
          <div className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Team + membership — read-only; management lives on the Team page */}
        <div className="grid grid-cols-2 gap-4 border-t border-line pt-4">
          <div className="grid content-start gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Team</span>
            {activeOrg ? (
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{activeOrg.name}</span>
                <span className="shrink-0 rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-semibold capitalize text-primary">
                  {activeOrg.myRole}
                </span>
                <Link
                  to="/team"
                  className="shrink-0 text-xs font-medium text-primary transition-colors hover:text-primary-dark"
                >
                  Manage →
                </Link>
              </div>
            ) : (
              <span className="text-sm text-ink-muted">
                {orgLoading ? 'Loading…' : orgError ? 'Unavailable' : 'No team yet'}
              </span>
            )}
          </div>
          <div className="grid content-start gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Member since</span>
            <span className="text-sm font-medium text-ink">{memberSince}</span>
          </div>
        </div>

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
