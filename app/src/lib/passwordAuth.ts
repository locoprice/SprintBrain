// Password sign-in rules shared by /signup, /login and Settings > Security.

/** New passwords need at least this many characters. Sign-in accepts any length. */
export const PASSWORD_MIN_LENGTH = 8;

export function isNewPasswordLongEnough(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}

/** The fields of a GoTrue error the wording depends on. */
export interface AuthErrorLike {
  code?: string;
  message: string;
}

/**
 * Plain wording for a failed sign-up or password change. GoTrue's own message
 * is kept where it is already readable (weak_password names the rule that
 * failed); the codes below get SprintBrain wording instead.
 */
export function passwordErrorMessage(err: AuthErrorLike): string {
  switch (err.code) {
    case 'same_password':
      return "That's already your password. Choose a different one.";
    case 'reauthentication_needed':
      return 'For your security, sign out and sign in again, then set your password.';
    case 'over_email_send_rate_limit':
      return 'Too many emails sent. Wait a few minutes and try again.';
    case 'email_address_invalid':
      return 'Enter a valid email address.';
    case 'signup_disabled':
      return 'New accounts are closed right now.';
    default:
      return err.message;
  }
}

/**
 * GoTrue answers a sign-up for an email that already has an account with a
 * stand-in user whose identities list is empty, and sends no email. Without
 * this check the person would wait for a confirmation that never comes.
 */
export function isExistingAccountSignup(
  user: { identities?: unknown[] | null } | null | undefined,
): boolean {
  return Array.isArray(user?.identities) && user.identities.length === 0;
}
