import { Boxes, Info, Share2, Zap } from 'lucide-react';

interface Step {
  icon: typeof Share2;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: Boxes,
    title: 'Group into a folder',
    body: 'Put related snippets or prompts in a folder. Sharing works per folder, not per item.',
  },
  {
    icon: Share2,
    title: 'Share the folder',
    body: 'Hit Share on the folder, then pick the whole team or specific teammates.',
  },
  {
    icon: Zap,
    title: 'Teammates use it instantly',
    body: 'Shared items appear automatically in their dashboard and Chrome extension.',
  },
];

/**
 * Benefit-driven explainer for folder-level team sharing. Clarifies that team
 * sharing (Supabase, in-app, instant) is separate from Notion sync (an optional
 * external mirror) — the most common point of confusion on this surface.
 */
export function TeamSharingGuide() {
  return (
    <section className="rounded-[16px] border border-line bg-card p-6">
      <header className="mb-5">
        <h2 className="text-base font-semibold text-ink">
          Share once. Your whole team gets it.
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Sharing a folder makes its snippets and prompts available to your teammates instantly.
        </p>
      </header>

      <ol className="grid grid-cols-3 gap-4">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="flex flex-col gap-2 rounded-[12px] border border-line bg-bg-alt/50 p-4"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                {i + 1}
              </span>
              <step.icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">{step.title}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex items-start gap-2.5 rounded-[12px] border border-line bg-bg-alt px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" />
        <p className="text-xs leading-relaxed text-ink-muted">
          <span className="font-semibold text-ink">Team sharing is separate from Notion sync.</span>{' '}
          Sharing lives in SprintBrain and updates teammates instantly. The “Sync” buttons on
          snippets and prompts mirror them to your external Notion database — they don’t change what
          your team can see.
        </p>
      </div>
    </section>
  );
}
