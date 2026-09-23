import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Ancestor trail rendered above the title (nested folders). */
  breadcrumb?: ReactNode;
  /** Short kind label set to the right of the title, on the same baseline. */
  tag?: string;
}

export function PageHeader({ title, description, action, breadcrumb, tag }: PageHeaderProps) {
  const heading = <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>;
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1">{breadcrumb}</div> : null}
        {tag ? (
          <div className="flex items-baseline gap-2.5">
            {heading}
            <span className="text-sm font-medium text-ink-subtle">[{tag}]</span>
          </div>
        ) : (
          heading
        )}
        {description ? (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
