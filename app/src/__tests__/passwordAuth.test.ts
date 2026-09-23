import { describe, expect, it } from 'vitest';
import {
  isExistingAccountSignup,
  isNewPasswordLongEnough,
  passwordErrorMessage,
  PASSWORD_MIN_LENGTH,
} from '@/lib/passwordAuth';

// Password sign-up and Settings > Security: the length rule, the wording of
// GoTrue's errors, and the "email already has an account" answer that
// GoTrue disguises as a normal sign-up.

describe('isNewPasswordLongEnough', () => {
  it(`needs at least ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(isNewPasswordLongEnough('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(isNewPasswordLongEnough('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(isNewPasswordLongEnough('')).toBe(false);
  });
});

describe('passwordErrorMessage', () => {
  it('rewords the codes people can act on', () => {
    expect(passwordErrorMessage({ code: 'same_password', message: 'x' })).toMatch(
      /already your password/,
    );
    expect(passwordErrorMessage({ code: 'reauthentication_needed', message: 'x' })).toMatch(
      /sign out and sign in again/,
    );
    expect(passwordErrorMessage({ code: 'over_email_send_rate_limit', message: 'x' })).toMatch(
      /Too many emails/,
    );
    expect(passwordErrorMessage({ code: 'email_address_invalid', message: 'x' })).toBe(
      'Enter a valid email address.',
    );
  });

  it("keeps GoTrue's own wording where it already names the rule", () => {
    expect(
      passwordErrorMessage({
        code: 'weak_password',
        message: 'Password should be at least 8 characters.',
      }),
    ).toBe('Password should be at least 8 characters.');
    expect(passwordErrorMessage({ message: 'Network request failed' })).toBe(
      'Network request failed',
    );
  });
});

describe('isExistingAccountSignup', () => {
  it('spots the stand-in user GoTrue returns for a taken email', () => {
    expect(isExistingAccountSignup({ identities: [] })).toBe(true);
  });

  it('is false for a real new sign-up or a missing user', () => {
    expect(isExistingAccountSignup({ identities: [{ provider: 'email' }] })).toBe(false);
    expect(isExistingAccountSignup({ identities: null })).toBe(false);
    expect(isExistingAccountSignup({})).toBe(false);
    expect(isExistingAccountSignup(null)).toBe(false);
    expect(isExistingAccountSignup(undefined)).toBe(false);
  });
});
