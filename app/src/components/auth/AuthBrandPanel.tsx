import { Check, ShieldCheck, Users } from 'lucide-react';

// Left brand panel shared by the login and signup split-screens.
// Hidden below `lg` — the form panel goes full-width on narrow viewports.
const FEATURES = [
  'Smart text expansion with a live formula engine',
  'Synced across Chrome, web, and mobile',
  'Works in Gmail, Notion, Slack, and your CRM',
] as const;

export function AuthBrandPanel() {
  return (
    <aside
      aria-hidden="true"
      className="hidden lg:flex lg:w-[44%] flex-col justify-between bg-gradient-to-b from-primary to-primary-dark p-12 xl:p-16"
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-white/20 text-[15px] font-extrabold text-white">
          S
        </div>
        <span className="text-[16px] font-bold tracking-tight text-white">
          SprintBrain
        </span>
      </div>

      {/* Hero copy + feature list */}
      <div className="space-y-8">
        <div className="space-y-4">
          <h2 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-white xl:text-[44px]">
            Type once.
            <br />
            Use it
            <br />
            everywhere.
          </h2>
          <p className="text-[15px] leading-relaxed text-white/70">
            Snippets, prompts, and live formulas — wherever you type.
          </p>
        </div>

        <ul className="space-y-3" aria-label="Key features">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-sm text-white/85">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20">
                <Check className="h-3 w-3 text-white" aria-hidden="true" />
              </div>
              {feature}
            </li>
          ))}
        </ul>
      </div>

      {/* Trust signals + footer */}
      <div className="space-y-6">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5 text-[13px] text-white/75">
            <ShieldCheck className="h-4 w-4 shrink-0 text-white/90" aria-hidden="true" />
            Encrypted and EU-hosted. Your data stays yours.
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-white/75">
            <Users className="h-4 w-4 shrink-0 text-white/90" aria-hidden="true" />
            Built and used daily by the LeibTour ops team.
          </div>
        </div>
        <p className="text-[12px] text-white/35">© 2026 SprintBrain</p>
      </div>
    </aside>
  );
}
