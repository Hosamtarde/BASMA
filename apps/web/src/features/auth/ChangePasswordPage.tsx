import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormAlert, PasswordField } from '@/components/ui/field';
import { applyServerErrors, renderMessage } from '@/lib/form-messages';
import { authKeys, changePassword, meQuery, signIn } from './api';
import { AuthLayout } from './AuthLayout';
import { changePasswordSchema, PASSWORD_MIN_LENGTH } from './policy';
import type { ChangePasswordForm } from './policy';

/**
 * Forced after login when mustChangePassword is set, and reachable from the user menu.
 * The server ends every session on success, so the page signs in again with the new password.
 */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ChangePasswordForm>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: async (v: ChangePasswordForm) => {
      await changePassword(v.currentPassword, v.newPassword);
      await signIn(me.username, v.newPassword);
    },
    meta: { inlineErrors: true },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authKeys.me });
      toast.success(t('auth.password.done'));
      void navigate('/', { replace: true });
    },
    onError: (err) => setFormError(applyServerErrors(err, form.setError, ['currentPassword', 'newPassword'])),
  });

  return (
    <AuthLayout
      title={t('auth.password.title')}
      intro={me.mustChangePassword ? t('auth.password.forcedIntro') : t('auth.password.intro')}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <FormAlert>{formError}</FormAlert>
        <PasswordField
          label={t('auth.password.current')}
          autoComplete="current-password"
          required
          error={renderMessage(t, errors.currentPassword?.message)}
          {...form.register('currentPassword')}
        />
        <PasswordField
          label={t('auth.password.new')}
          autoComplete="new-password"
          required
          hint={t('auth.password.hint', { count: PASSWORD_MIN_LENGTH })}
          error={renderMessage(t, errors.newPassword?.message)}
          {...form.register('newPassword')}
        />
        <PasswordField
          label={t('auth.password.confirm')}
          autoComplete="new-password"
          required
          error={renderMessage(t, errors.confirmPassword?.message)}
          {...form.register('confirmPassword')}
        />
        <div className="mt-2 flex flex-wrap gap-2.5">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('auth.password.submitting') : t('auth.password.submit')}
          </Button>
          {!me.mustChangePassword && (
            <Button variant="secondary" onClick={() => void navigate(-1)}>
              {t('common.close')}
            </Button>
          )}
        </div>
      </form>
    </AuthLayout>
  );
}
