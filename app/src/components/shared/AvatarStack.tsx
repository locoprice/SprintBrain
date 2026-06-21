import { cn } from '@/lib/utils';
import { Avatar } from '@/components/shared/Avatar';

export interface StackMember {
  id: string;
  name?: string | null;
  email?: string | null;
  /** Render as the current user (solid fill). */
  highlight?: boolean;
}

interface AvatarStackProps {
  members: StackMember[];
  /** Max faces before collapsing the rest into a "+N" chip. */
  max?: number;
  size?: 'xs' | 'sm';
  className?: string;
}

/**
 * Overlapping faces with a "+N" overflow chip — the at-a-glance "who has access"
 * affordance for shared folders. Each face gets a card-colored ring so the
 * overlap reads cleanly.
 */
export function AvatarStack({ members, max = 5, size = 'xs', className }: AvatarStackProps) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;

  return (
    <div className={cn('flex items-center', className)}>
      <div className="flex -space-x-1.5">
        {shown.map((m) => (
          <Avatar
            key={m.id}
            name={m.name}
            email={m.email}
            highlight={m.highlight}
            size={size}
            className="ring-2 ring-card"
          />
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-1.5 text-[11px] font-medium text-ink-subtle">+{extra}</span>
      )}
    </div>
  );
}
