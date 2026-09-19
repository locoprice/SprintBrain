import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type AuthMethod = 'email' | 'password';

/**
 * The Email link / Password choice at the top of /login and /signup. The
 * email address typed on one tab carries over to the other.
 */
export function AuthMethodTabs({
  value,
  onChange,
  disabled = false,
}: {
  value: AuthMethod;
  onChange: (next: AuthMethod) => void;
  disabled?: boolean;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next === 'password' ? 'password' : 'email')}
    >
      <TabsList className="grid w-full grid-cols-2" aria-label="Email link or password">
        <TabsTrigger value="email" disabled={disabled}>
          Email link
        </TabsTrigger>
        <TabsTrigger value="password" disabled={disabled}>
          Password
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
