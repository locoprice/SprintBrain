type AuthEventName =
  | 'signup_started'
  | 'signup_completed'
  | 'auth_method_selected'
  | 'magic_link_sent'
  | 'login_completed'
  | 'auth_failed'
  | 'password_recovery_started'
  | 'onboarding_completed';

type EventProperties = Record<string, string | number | boolean | null | undefined>;

function track(_event: AuthEventName, _properties?: EventProperties): void {
  // Future integration: PostHog, Segment, or a Supabase analytics table.
}

export const analytics = { track };
