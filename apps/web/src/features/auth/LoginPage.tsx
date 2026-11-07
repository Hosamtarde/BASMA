import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { session } from '@/api/session';
import { Button } from '@/components/ui/button';
import { FormAlert, PasswordField, TextField } from '@/components/ui/field';
import { applyServerErrors, renderMessage } from '@/lib/form-messages';
import { signIn } from './api';
import { AuthLayout } from './AuthLayout';
import { loginSchema } from './policy';
import type { LoginForm } from './policy';

/** Where to go after signing in: the page that asked for it, never an outside URL. */
function safeFrom(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });
  const { errors } = form.formState;

  const login = useMutation({
    mutationFn: (v: LoginForm) => signIn(v.username, v.password),
    meta: { inlineErrors: true },
    onSuccess: (tokens) => {
      void navigate(tokens.mustChangePassword ? '/change-password' : safeFrom(location.state), {
        replace: true,
      });
    },
    onError: (err) => {
      setFormError(applyServerErrors(err, form.setError, ['username', 'password']));
      form.resetField('password');
    },
  });

  if (session.isAuthenticated()) return <Navigate to="/" replace />;

  return (
    <AuthLayout title={t('auth.login.title')} intro={t('auth.login.intro')}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          login.mutate(v);
        })}
      >
        <FormAlert>{formError}</FormAlert>
        <TextField
          label={t('auth.login.username')}
          autoComplete="username"
          required
          dir="auto"
          error={renderMessage(t, errors.username?.message)}
          {...form.register('username')}
        />
        <PasswordField
          label={t('auth.login.password')}
          autoComplete="current-password"
          required
          error={renderMessage(t, errors.password?.message)}
          {...form.register('password')}
        />
        <Button type="submit" className="mt-2" disabled={login.isPending}>
          {login.isPending ? t('auth.login.submitting') : t('auth.login.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
