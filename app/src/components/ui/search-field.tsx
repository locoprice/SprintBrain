import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Typing stays instant; propagation waits this long. */
  debounceMs?: number;
  className?: string;
}

/**
 * The search field for snippets, prompts and memory. Same width, same icon,
 * same debounce on all three, so the search row reads identically wherever a
 * user lands.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  debounceMs = 300,
  className,
}: SearchFieldProps) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follows an external reset, which is how "Clear filters" in an empty state
  // empties the box it does not own.
  useEffect(() => {
    if (value === '') {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setLocal('');
    }
  }, [value]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  function push(next: string) {
    setLocal(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange(next);
      timer.current = null;
    }, debounceMs);
  }

  function clear() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setLocal('');
    onChange('');
  }

  return (
    <div className={cn('relative w-full max-w-md', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
      <Input
        type="text"
        value={local}
        onChange={(e) => push(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9"
      />
      {local !== '' && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
