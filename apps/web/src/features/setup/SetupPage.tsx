import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api, unwrap } from '@/api/client';
import { Button } from '@/components/ui/button';
import { FormAlert, PasswordField, SelectField, TextField } from '@/components/ui/field';
import { signIn } from '@/features/auth/api';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { PASSWORD_MIN_LENGTH } from '@/features/auth/policy';
import { useSwitchLanguage } from '@/features/shell/settings';
import { currentLanguage, isLanguage, LANGUAGES } from '@/i18n/i18n';
import { applyServerErrors, renderMessage } from '@/lib/form-messages';
import { setupKeys } from './api';
import { browserTimeZone, SETUP_SERVER_FIELDS, setupSchema } from './schema';
import type { SetupForm, SetupFormInput } from './schema';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid grid-cols-1 gap-4 border-t border-border pt-4 md:grid-cols-2">
      <legend className="pe-2 text-[15px] font-extrabold">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * First run, one step (SPEC §5.18): owner account, lab name (Arabic or English) + phone +
 * currency, language and time zone. Signs in automatically afterwards. Restoring a backup
 * arrives with B7, so it is not offered yet.
 */
export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const switchLanguage = useSwitchLanguage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SetupFormInput, unknown, SetupForm>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      username: '',
      password: '',
      confirmPassword: '',
      lab: { nameAr: '', nameEn: '', phone: '', address: '' },
      // Owner answer (Phase 0): ₪ ILS with 2 decimals; editable here.
      currency: { code: 'ILS', symbol: '₪', decimals: 2 },
      language: currentLanguage(),
      timeZone: browserTimeZone(),
    },
  });
  const { errors } = form.formState;
  const err = (m: string | undefined) => renderMessage(t, m);
  const blankToNull = (s: string) => (s === '' ? null : s);

  const setup = useMutation({
    mutationFn: async (v: SetupForm) => {
      await unwrap(
        api.POST('/api/v1/setup', {
          body: {
            username: v.username,
            password: v.password,
            lab: {
              nameAr: blankToNull(v.lab.nameAr),
              nameEn: blankToNull(v.lab.nameEn),
              phone: v.lab.phone,
              address: blankToNull(v.lab.address),
            },
            currency: v.currency,
            language: v.language,
            timeZone: v.timeZone,
          },
        }),
      );
      await signIn(v.username, v.password);
    },
    meta: { inlineErrors: true },
    onSuccess: () => {
      queryClient.setQueryData(setupKeys.status, { setupRequired: false });
      toast.success(t('setup.done'));
      void navigate('/', { replace: true });
    },
    onError: (e) => setFormError(applyServerErrors(e, form.setError, SETUP_SERVER_FIELDS)),
  });

  return (
    <AuthLayout title={t('setup.title')} intro={t('setup.intro')} wide>
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          setup.mutate(v);
        })}
      >
        <FormAlert>{formError}</FormAlert>
        <Section title={t('setup.account')}>
          <TextField
            label={t('setup.username')}
            hint={t('setup.usernameHint')}
            autoComplete="username"
            required
            dir="auto"
            error={err(errors.username?.message)}
            {...form.register('username')}
          />
          <span className="hidden md:block" />
          <PasswordField
            label={t('setup.password')}
            hint={t('auth.password.hint', { count: PASSWORD_MIN_LENGTH })}
            autoComplete="new-password"
            required
            error={err(errors.password?.message)}
            {...form.register('password')}
          />
          <PasswordField
            label={t('setup.confirmPassword')}
            autoComplete="new-password"
            required
            error={err(errors.confirmPassword?.message)}
            {...form.register('confirmPassword')}
          />
        </Section>

        <Section title={t('setup.lab')}>
          <TextField
            label={t('setup.nameAr')}
            hint={t('setup.nameHint')}
            dir="rtl"
            lang="ar"
            autoComplete="organization"
            error={err(errors.lab?.nameAr?.message)}
            {...form.register('lab.nameAr')}
          />
          <TextField
            label={t('setup.nameEn')}
            dir="ltr"
            lang="en"
            error={err(errors.lab?.nameEn?.message)}
            {...form.register('lab.nameEn')}
          />
          <TextField
            label={t('setup.phone')}
            type="tel"
            dir="ltr"
            autoComplete="tel"
            required
            error={err(errors.lab?.phone?.message)}
            {...form.register('lab.phone')}
          />
          <TextField
            label={t('setup.address')}
            dir="auto"
            autoComplete="street-address"
            error={err(errors.lab?.address?.message)}
            {...form.register('lab.address')}
          />
        </Section>

        <Section title={t('setup.currency')}>
          <TextField
            label={t('setup.currencyCode')}
            dir="ltr"
            required
            error={err(errors.currency?.code?.message)}
            {...form.register('currency.code')}
          />
          <TextField
            label={t('setup.currencySymbol')}
            dir="auto"
            required
            error={err(errors.currency?.symbol?.message)}
            {...form.register('currency.symbol')}
          />
          <SelectField
            label={t('setup.decimals')}
            hint={t('setup.currencyHint')}
            required
            error={err(errors.currency?.decimals?.message)}
            {...form.register('currency.decimals')}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
        </Section>

        <Section title={t('setup.preferences')}>
          <SelectField
            label={t('setup.language')}
            required
            error={err(errors.language?.message)}
            {...form.register('language', {
              // The page switches language with the choice, so the owner sees what they pick.
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                if (isLanguage(e.target.value)) void switchLanguage(e.target.value);
              },
            })}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l} lang={l}>
                {t(`language.name.${l}`)}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t('setup.timeZone')}
            hint={t('setup.timeZoneHint')}
            dir="ltr"
            required
            error={err(errors.timeZone?.message)}
            {...form.register('timeZone')}
          />
        </Section>

        <div>
          <Button type="submit" disabled={setup.isPending}>
            {setup.isPending ? t('setup.submitting') : t('setup.submit')}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
