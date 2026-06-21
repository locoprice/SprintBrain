import { cn } from '@/lib/utils';

type AvatarSize = 'xs' | 'sm' | 'md';

interface AvatarProps {
  name?: string | null;
  email?: string | null;
  /** Highlight as the current user (solid azure fill instead of light tint). */
  highlight?: boolean;
  size?: AvatarSize;
  /** Tooltip override. Defaults to the person's name/email. */
  title?: string;
  className?: string;
}

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
};

function labelFor(name?: string | null, email?: string | null): string {
  return (name && name.trim()) || (email && email.trim()) || 'Teammate';
}

function initialFor(name?: string | null, email?: string | null): string {
  const source = (name && name.trim()) || (email && email.trim());
  return source ? source.slice(0, 1).toUpperCase() : '?';
}

/**
 * Initial-circle avatar. Stays within the brand primary family (no new palette
 * colors): the current user reads as a solid azure fill, teammates as a light
 * azure tint — the same combo the sidebar and prompt cards already use. Identity
 * comes from the display name, falling back to email.
 */
export function Avatar({ name, email, highlight = false, size = 'sm', title, className }: AvatarProps) {
  const label = labelFor(name, email);
  return (
    <span
      title={title ?? label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold',
        SIZE_CLASS[size],
        highlight ? 'bg-primary text-white' : 'bg-primary-light text-primary',
        className,
      )}
    >
      {initialFor(name, email)}
    </span>
  );
}
