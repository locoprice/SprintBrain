import { useEffect, useState } from 'react';

// Fabricated "recent signups" social-proof chips — a marketing fixture, NOT real
// users. The names are invented and rotate on a timer to convey signup activity
// on the registration page. No backend, no real data, no PII.
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['ines', 'alex'],
  ['marco', 'sofia'],
  ['luca', 'emma'],
  ['carlos', 'nina'],
  ['theo', 'lena'],
  ['noah', 'giulia'],
];

const ROTATE_MS = 3500;

export function RecentSignups() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((n) => (n + 1) % PAIRS.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const pair = PAIRS[index];
  if (!pair) return null;

  return (
    <div className="space-y-2 text-center" aria-hidden="true">
      <p className="text-xs font-medium text-ink-subtle">Recent signups:</p>
      <div
        key={index}
        className="flex items-center justify-center gap-2 animate-fade-in"
      >
        {pair.map((name, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-line bg-bg-alt px-2.5 py-1 text-xs text-ink-muted"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            {name}@… just now
          </span>
        ))}
      </div>
    </div>
  );
}
