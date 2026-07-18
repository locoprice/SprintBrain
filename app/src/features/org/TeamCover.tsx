import { useRef, useState } from 'react';
import { AlertCircle, ImagePlus, ImageUp, Trash2, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pickHttpsUrl, COVER_INPUT_ACCEPT, validateImageFile, COVER_MAX_BYTES } from '@/lib/branding';
import { coverPresetClass, isImageCover, TEAM_COVER_PRESETS } from '@/lib/teamCoverPresets';
import { useAuthStore } from '@/stores/authStore';
import { useOrgStore } from '@/stores/orgStore';
import { useUiStore } from '@/stores/uiStore';

const DESCRIPTION = 'Your team, everything you share, and who can use it — in one place.';

/**
 * Notion-style header for the Team page (TEAM-COVER-001). Renders the team
 * cover (a preset gradient or an uploaded image) with the org identity card
 * overlapping its lower edge. Admins get hover controls + a gallery picker to
 * change, upload, or remove the cover; everyone else sees it read-only. The
 * cover is one value per organization, so the whole team sees the same choice.
 *
 * Breaks out of the dashboard content padding (`-mx-8 -mt-8`) so the cover
 * spans full width and meets the top edge, the way a Notion cover does.
 */
export function TeamCover() {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const setCover = useOrgStore((s) => s.setCover);
  const uploadCover = useOrgStore((s) => s.uploadCover);
  const user = useAuthStore((s) => s.user);
  const showToast = useUiStore((s) => s.showToast);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const isAdmin = activeOrg?.myRole === 'admin';
  const cover = activeOrg?.cover ?? null;
  const hasCover = cover !== null;
  const companyLogo = pickHttpsUrl(user?.user_metadata, 'company_logo_url');
  const orgName = activeOrg?.name ?? 'Team';
  const initial = orgName.slice(0, 1).toUpperCase();

  async function applyCover(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      await setCover(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the cover.');
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const invalid = validateImageFile(file, COVER_MAX_BYTES);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadCover(file);
      setPickerOpen(false);
      showToast('Cover updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    await applyCover(null);
    setPickerOpen(false);
    if (!error) showToast('Cover removed');
  }

  const coverStyle = isImageCover(cover)
    ? { backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined;
  const coverClass = !isImageCover(cover) && cover ? coverPresetClass(cover) : '';

  return (
    <div className="mb-6">
      {/* Cover band (full-bleed) or, for admins with no cover, an "Add cover" affordance */}
      {hasCover ? (
        <div
          className={cn(
            'group relative -mx-8 -mt-8 h-[210px] overflow-hidden',
            coverClass,
          )}
          style={coverStyle}
        >
          {isAdmin && (
            <div className="absolute right-5 top-4 flex gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <CoverButton onClick={() => setPickerOpen((v) => !v)} disabled={busy}>
                <ImageUp className="h-3.5 w-3.5" />
                Change cover
              </CoverButton>
              <CoverButton onClick={onRemove} disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </CoverButton>
            </div>
          )}
        </div>
      ) : isAdmin ? (
        <div className="-mt-2 mb-3">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-2 text-sm font-medium text-ink-subtle transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            <ImagePlus className="h-4 w-4" />
            Add cover
          </button>
        </div>
      ) : null}

      {/* Identity: logo/initial card + eyebrow + org name + description */}
      <div className={cn('flex items-end gap-4', hasCover ? '-mt-8 px-1' : 'mt-0')}>
        <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] border border-line bg-card shadow-sm">
          {companyLogo ? (
            <img
              src={companyLogo}
              alt=""
              draggable={false}
              className="max-h-[52px] max-w-[52px] object-contain"
            />
          ) : (
            <span className="text-2xl font-bold text-primary">{initial}</span>
          )}
        </div>
        <div className="min-w-0 pb-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            Team
          </div>
          <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight text-ink">{orgName}</h1>
          <p className="mt-1 text-sm text-ink-muted">{DESCRIPTION}</p>
        </div>
      </div>

      {/* Hidden file input for uploads */}
      <input
        ref={fileRef}
        type="file"
        accept={COVER_INPUT_ACCEPT}
        onChange={onPickFile}
        className="hidden"
        aria-label="Upload team cover"
      />

      {/* Gallery picker (admins only) */}
      {isAdmin && pickerOpen && (
        <section
          className="mt-4 rounded-[16px] border border-line bg-card p-4 shadow-md"
          aria-label="Cover gallery"
        >
          <div className="mb-3 flex items-center">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Cover gallery
            </span>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              aria-label="Close gallery"
              className="ml-auto rounded-[6px] p-1 text-ink-subtle transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {TEAM_COVER_PRESETS.map((p) => {
              const active = cover === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyCover(p.key)}
                  disabled={busy}
                  aria-pressed={active}
                  title={p.label}
                  className={cn(
                    'relative h-[52px] w-[104px] overflow-hidden rounded-[10px] border border-line disabled:opacity-60',
                    coverPresetClass(p.key),
                    active && 'ring-2 ring-primary ring-offset-2 ring-offset-card',
                  )}
                >
                  <span className="absolute bottom-1 left-2 text-[10px] font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.4)]">
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-2 text-[12.5px] font-medium text-ink-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              <UploadCloud className="h-4 w-4" />
              {busy ? 'Working…' : 'Upload image'}
              <span className="text-[11px] font-normal text-ink-subtle">PNG/JPG/WebP · 2 MB</span>
            </button>
            {hasCover && (
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                className="ml-auto rounded-[8px] px-2 py-1.5 text-[12.5px] font-semibold text-ink-subtle transition-colors hover:text-danger disabled:opacity-60"
              >
                Remove cover
              </button>
            )}
          </div>
        </section>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function CoverButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-[8px] border border-black/10 bg-white/90 px-2.5 py-1.5 text-xs font-semibold text-[#1C1C1E] shadow-sm backdrop-blur-sm transition-colors hover:bg-white disabled:opacity-60"
    >
      {children}
    </button>
  );
}
