import { Chrome, Smartphone, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Integration {
  name: string;
  description: string;
  icon: LucideIcon;
  status: 'connected' | 'soon';
  meta?: string;
}

const INTEGRATIONS: Integration[] = [
  {
    name: 'Chrome Extension',
    description: 'The browser extension that injects snippets into any text field.',
    icon: Chrome,
    status: 'connected',
    meta: 'v2.14.0',
  },
  {
    name: 'Mobile App',
    description: 'Lightweight web app for snippets on the go (iOS & Android).',
    icon: Smartphone,
    status: 'connected',
    meta: 'available at /mobile/',
  },
  {
    name: 'Zapier',
    description: 'Trigger snippets from any Zapier workflow. Coming soon.',
    icon: Zap,
    status: 'soon',
  },
];

export function IntegrationsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          External surfaces that read from the same Supabase source of truth.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {INTEGRATIONS.map((it) => (
          <div
            key={it.name}
            className="flex items-start justify-between gap-4 rounded-[12px] border border-line bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-bg-alt text-ink-muted">
                <it.icon className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{it.name}</span>
                  {it.meta ? (
                    <span className="text-xs text-ink-subtle">{it.meta}</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-ink-muted">{it.description}</p>
              </div>
            </div>
            {it.status === 'connected' ? (
              <Badge variant="success">Connected</Badge>
            ) : (
              <Badge variant="outline">Soon</Badge>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
