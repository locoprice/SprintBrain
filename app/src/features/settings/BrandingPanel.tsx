import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ImagePlus, Trash2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { COMPANY_NAME_MAX, IMAGE_INPUT_ACCEPT, validateImageFile } from '@/lib/branding';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * "Company branding" card (BRANDING-001). The uploaded logo (or the company
 * name as a text wordmark) co-brands the topbar next to the SprintBrain brand
 * and replaces the sidebar watermark. Logo changes apply immediately on pick /
 * remove; the name uses the same explicit Save flow as the Account card.
 */
export function BrandingPanel() {
  const profile = useSettingsStore((s) => s.profile);
  const editProfile = useSettingsStore((s) => s.editProfile);
  const setCompanyLogo = useSettingsStore((s) => s.setCompanyLogo);
  const clearCompanyLogo = useSettingsStore((s) => s.clearCompanyLogo);
  const showToast = useUiStore((s) => s.showToast);

  const [companyName, setCompanyName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Hydrate the name field from the store when the profile lands or changes.
  useEffect(() => {
    if (!profile) return;
    setCompanyName(profile.company_name);
  }, [profile]);

  // Briefly show "Saved" after a successful name write.
  useEffect(() => {
    if (savedAt === null) return;
    const t = window.setTimeout(() => setSavedAt(null), 2000);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const trimmed = companyName.trim();
  const dirty = profile !== null && trimmed !== profile.company_name;
  const nameTooLong = trimmed.length > COMPANY_NAME_MAX;
  const logoUrl = profile?.company_logo_url ?? null;
  const logoBusy = uploading || removing || profile === null;

  async function onSaveName() {
    if (!dirty || nameTooLong || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await editProfile({ company_name: trimmed });
      setSavedAt(Date.now());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function onCancelName() {
    setCompanyName(profile?.company_name ?? '');
    setErrorMsg(null);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
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
      await setCompanyLogo(file);
      showToast('Logo updated');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onRemoveLogo() {
    if (removing) return;
    setRemoving(true);
    setErrorMsg(null);
    try {
      await clearCompanyLogo();
      showToast('Logo removed');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company branding</CardTitle>
        <CardDescription>
          Make the dashboard yours — your logo and company name appear next to the
          SprintBrain brand.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live preview — mirrors the topbar co-brand */}
        <div className="flex h-[52px] items-center gap-2.5 rounded-[12px] border border-line bg-bg px-4">
          <div className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-primary text-xs font-extrabold text-white">
            S
          </div>
          <span className="text-sm font-bold tracking-tight text-ink">SprintBrain</span>
          {logoUrl || trimmed ? (
            <>
              <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-ink-subtle" aria-hidden="true" />
              {logoUrl ? (
                <span className="flex items-center rounded-[8px] bg-white px-1.5 py-1">
                  <img
                    src={logoUrl}
                    alt={trimmed || 'Company logo'}
                    draggable={false}
                    className="max-h-5 max-w-[140px] object-contain"
                  />
                </span>
              ) : (
                <span className="max-w-[180px] truncate text-sm font-bold tracking-tight text-ink">
                  {trimmed}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-ink-subtle">Your brand appears here</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Logo */}
          <div className="grid content-start gap-2">
            <span className="text-xs font-medium text-ink-muted">Logo</span>
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_INPUT_ACCEPT}
              onChange={onPickFile}
              className="hidden"
              aria-label="Upload company logo"
            />
            {logoUrl ? (
              <div className="flex items-center gap-3">
                <span className="flex h-14 w-28 shrink-0 items-center justify-center rounded-[10px] border border-line bg-white p-2">
                  <img
                    src={logoUrl}
                    alt="Current company logo"
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                  />
                </span>
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={logoBusy}
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {uploading ? 'Uploading…' : 'Replace'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onRemoveLogo}
                    disabled={logoBusy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {removing ? 'Removing…' : 'Remove'}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={logoBusy}
                className="flex h-14 items-center justify-center gap-2 rounded-[10px] border border-dashed border-line bg-bg-alt text-sm font-medium text-ink-muted transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UploadCloud className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Upload logo'}
              </button>
            )}
            <span className="text-xs text-ink-subtle">PNG, JPG, WebP, or SVG · max 1 MB.</span>
          </div>

          {/* Company name */}
          <div className="grid content-start gap-2">
            <label htmlFor="company-name" className="text-xs font-medium text-ink-muted">
              Company name
            </label>
            <Input
              id="company-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              maxLength={COMPANY_NAME_MAX + 1}
              disabled={saving || profile === null}
              placeholder="e.g. LeibTour"
            />
            {nameTooLong && (
              <span className="text-xs text-danger">
                Company name must be {COMPANY_NAME_MAX} characters or fewer.
              </span>
            )}
            <span className="text-xs text-ink-subtle">
              Shown when no logo is set, and as the logo&apos;s hover text.
            </span>
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
            <Button type="button" variant="ghost" onClick={onCancelName} disabled={!dirty || saving}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={onSaveName}
              disabled={!dirty || nameTooLong || saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
