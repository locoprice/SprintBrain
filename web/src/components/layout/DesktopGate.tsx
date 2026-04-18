import { Smartphone } from 'lucide-react';

// Rendered for any viewport below 1024px. The dashboard is desktop-only by
// product decision (see ticket TKT 2.14.0). Mobile users get pointed to the
// dedicated mobile app at /mobile/ which already exists in production.
export function DesktopGate() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary-light text-primary">
          <Smartphone className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          SprintBrain Dashboard is desktop-only
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          The full dashboard runs on screens 1024px and wider. On phones and
          small tablets, use the mobile app instead.
        </p>
        <a
          href="/mobile/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-[12px] bg-primary px-5 text-sm font-semibold text-white shadow-md hover:bg-primary-dark"
        >
          Open mobile app
        </a>
      </div>
    </div>
  );
}
