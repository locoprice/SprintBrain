import { useEffect } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyTheme, watchSystemTheme, type ThemePreference } from '@/lib/theme';
import { useUiStore } from '@/stores/uiStore';

const OPTIONS: { value: ThemePreference; icon: React.ElementType; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light mode' },
  { value: 'auto', icon: Monitor, label: 'Automatic (system)' },
  { value: 'dark', icon: Moon, label: 'Dark mode' },
];

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  // When in auto mode, re-resolve whenever the OS color scheme changes.
  useEffect(() => {
    if (theme !== 'auto') return;
    return watchSystemTheme(() => applyTheme('auto'));
  }, [theme]);

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center rounded-[10px] border border-line bg-bg-alt p-0.5"
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-[8px] transition-colors duration-150',
            theme === value
              ? 'bg-card text-ink shadow-sm'
              : 'text-ink-subtle hover:text-ink-muted',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
