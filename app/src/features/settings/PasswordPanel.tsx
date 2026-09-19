import { useState, type FormEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { securityApi } from '@/lib/api/securityApi';
import {
  isNewPasswordLongEnough,
  passwordErrorMessage,
  PASSWORD_MIN_LENGTH,
} from '@/lib/passwordAuth';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * Settings > Security "Password" card. The one place an account gets a
 * password, or a new one after "Forgot password?" (the reset link lands here).
 */
export function PasswordPanel() {
  const email = useAuthStore((s) => s.user?.email ?? '');
  const showToast = useUiStore((s) => s.showToast);

  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const longEnough = isNewPasswordLongEnough(password);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!longEnough || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await securityApi.setPassword(password);
      setPassword('');
      showToast('Password saved');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? passwordErrorMessage(err) : 'Could not save the password',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Sign in with your email and a password, on any device. Email links and Google keep
          working.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-2">
          {/* Tells password managers which account the new password belongs to. */}
          <input
            type="email"
            autoComplete="username"
            value={email}
            readOnly
            className="hidden"
          />
          <label htmlFor="new-password" className="text-xs font-medium text-ink-muted">
            New password
          </label>
          <div className="flex items-start gap-2">
            <div className="w-72">
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg(null);
                }}
                disabled={saving}
              />
            </div>
            <Button type="submit" variant="primary" disabled={!longEnough || saving}>
              {saving ? 'Saving…' : 'Save password'}
            </Button>
          </div>
          {errorMsg ? (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {errorMsg}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
