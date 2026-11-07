import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ImageUp, Lock, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { FormAlert, SelectField, TextField } from '@/components/ui/field';
import { Card } from '@/components/ui/list';
import { isTimeZone } from '@/features/setup/schema';
import { settingsKeys, settingsQuery, useLogoUrl } from '@/features/shell/settings';
import type { Settings } from '@/features/shell/settings';
import { formatNumber } from '@/i18n/format';
import { changeLanguage, currentLanguage, LANGUAGES, rememberLanguage } from '@/i18n/i18n';
import { applyServerErrors, msg, renderMessage } from '@/lib/form-messages';
import { checkLogoFile, MAX_LOGO_BYTES, settingsApi } from './api';

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <h2 id={id} className="text-[18px] font-extrabold">
        {title}
      </h2>
      {intro && <p className="mt-1 text-[14px] text-muted">{intro}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function LockNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warning-bg px-3 py-2 text-[13.5px] font-semibold text-warning-ink">
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Saves a settings section and puts the server's answer in the cache (shell, home and forms follow). */
function useSaveSettings<V>(fn: (v: V) => Promise<Settings>, done: string, onError?: (e: unknown) => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    meta: { inlineErrors: true },
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKeys.all, settings);
      toast.success(t(done as never));
    },
    ...(onError ? { onError } : {}),
  });
}

const text = (max: number) => z.string().trim().max(max, msg('validation.maxLength', { max }));
const profileSchema = z
  .object({
    nameAr: text(100),
    nameEn: text(100),
    phone: text(30).regex(/^[\p{Nd}+\-() ]*$/u, msg('validation.phoneFormat')),
    address: text(300),
    timeZone: z.string().trim().refine(isTimeZone, msg('validation.timeZone')),
  })
  .refine((v) => v.nameAr !== '' || v.nameEn !== '', {
    path: ['nameAr'],
    message: msg('validation.labNameRequired'),
  });
type ProfileForm = z.infer<typeof profileSchema>;
const nullIfBlank = (s: string) => (s === '' ? null : s);

function LabProfileSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const p = settings.labProfile;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: {
      nameAr: p?.nameAr ?? '',
      nameEn: p?.nameEn ?? '',
      phone: p?.phone ?? '',
      address: p?.address ?? '',
      timeZone: p?.timeZone ?? '',
    },
  });
  const save = useSaveSettings(
    (v: ProfileForm) =>
      settingsApi.labProfile({
        rowVersion: p?.rowVersion ?? 0,
        nameAr: nullIfBlank(v.nameAr),
        nameEn: nullIfBlank(v.nameEn),
        phone: nullIfBlank(v.phone),
        address: nullIfBlank(v.address),
        timeZone: v.timeZone,
      }),
    'settings.saved',
    (e) =>
      setFormError(applyServerErrors(e, form.setError, ['nameAr', 'nameEn', 'phone', 'address', 'timeZone'])),
  );
  const { errors } = form.formState;
  const err = (m: string | undefined) => renderMessage(t, m);
  return (
    <Section id="lab-profile" title={t('settings.labProfile')} intro={t('settings.labProfileIntro')}>
      <form
        noValidate
        aria-labelledby="lab-profile"
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <div className="md:col-span-2">
          <FormAlert>{formError}</FormAlert>
        </div>
        <TextField
          label={t('setup.nameAr')}
          hint={t('setup.nameHint')}
          dir="rtl"
          lang="ar"
          error={err(errors.nameAr?.message)}
          {...form.register('nameAr')}
        />
        <TextField
          label={t('setup.nameEn')}
          dir="ltr"
          lang="en"
          error={err(errors.nameEn?.message)}
          {...form.register('nameEn')}
        />
        <TextField
          label={t('setup.phone')}
          type="tel"
          dir="ltr"
          error={err(errors.phone?.message)}
          {...form.register('phone')}
        />
        <TextField
          label={t('setup.address')}
          dir="auto"
          error={err(errors.address?.message)}
          {...form.register('address')}
        />
        <TextField
          label={t('setup.timeZone')}
          hint={t('setup.timeZoneHint')}
          dir="ltr"
          required
          error={err(errors.timeZone?.message)}
          {...form.register('timeZone')}
        />
        <div className="flex items-end md:col-span-2">
          <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

const currencySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, msg('validation.required'))
    .max(10, msg('validation.maxLength', { max: 10 })),
  symbol: z
    .string()
    .trim()
    .min(1, msg('validation.required'))
    .max(5, msg('validation.maxLength', { max: 5 })),
  decimals: z.coerce
    .number()
    .int()
    .min(0, msg('validation.decimalsRange'))
    .max(3, msg('validation.decimalsRange')),
});
type CurrencyIn = z.input<typeof currencySchema>;
type CurrencyOut = z.output<typeof currencySchema>;

function CurrencySection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const c = settings.currency;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CurrencyIn, unknown, CurrencyOut>({
    resolver: zodResolver(currencySchema),
    values: { code: c?.code ?? '', symbol: c?.symbol ?? '', decimals: c?.decimals ?? 2 },
  });
  const save = useSaveSettings(
    (v: CurrencyOut) =>
      settingsApi.currency({
        rowVersion: c?.rowVersion ?? 0,
        // Locked fields are never sent; only what changed goes to the server.
        ...(!c?.locked.code && v.code !== c?.code ? { code: v.code } : {}),
        ...(v.symbol !== c?.symbol ? { symbol: v.symbol } : {}),
        ...(!c?.locked.decimals && v.decimals !== c?.decimals ? { decimals: v.decimals } : {}),
      }),
    'settings.saved',
    (e) => setFormError(applyServerErrors(e, form.setError, ['code', 'symbol', 'decimals'])),
  );
  const { errors } = form.formState;
  const err = (m: string | undefined) => renderMessage(t, m);
  const locked = c?.locked.code || c?.locked.decimals;
  return (
    <Section id="currency" title={t('setup.currency')}>
      <form
        noValidate
        aria-labelledby="currency"
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <FormAlert>{formError}</FormAlert>
        {locked ? (
          <LockNote>{t('settings.currencyLocked')}</LockNote>
        ) : (
          <p className="text-[13.5px] text-muted">{t('setup.currencyHint')}</p>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TextField
            label={t('setup.currencyCode')}
            dir="ltr"
            required
            disabled={c?.locked.code}
            error={err(errors.code?.message)}
            {...form.register('code')}
          />
          <TextField
            label={t('setup.currencySymbol')}
            dir="auto"
            required
            error={err(errors.symbol?.message)}
            {...form.register('symbol')}
          />
          <SelectField
            label={t('setup.decimals')}
            required
            disabled={c?.locked.decimals}
            error={err(errors.decimals?.message)}
            {...form.register('decimals')}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
        </div>
        <div>
          <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function LanguageSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const l = settings.language;
  const form = useForm<{ ui: 'ar' | 'en'; documents: 'ar' | 'en' }>({
    values: { ui: l?.ui ?? currentLanguage(), documents: l?.documents ?? currentLanguage() },
  });
  const save = useSaveSettings(async (v: { ui: 'ar' | 'en'; documents: 'ar' | 'en' }) => {
    const saved = await settingsApi.language({
      rowVersion: l?.rowVersion ?? 0,
      ui: v.ui,
      documents: v.documents,
    });
    if (v.ui !== currentLanguage()) {
      await changeLanguage(v.ui);
      rememberLanguage(v.ui);
    }
    return saved;
  }, 'settings.saved');
  return (
    <Section id="language" title={t('settings.language')} intro={t('settings.languageIntro')}>
      <form
        noValidate
        aria-labelledby="language"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
      >
        <SelectField label={t('settings.uiLanguage')} {...form.register('ui')}>
          {LANGUAGES.map((x) => (
            <option key={x} value={x} lang={x}>
              {t(`language.name.${x}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('settings.documentLanguage')}
          hint={t('settings.documentLanguageHint')}
          {...form.register('documents')}
        >
          {LANGUAGES.map((x) => (
            <option key={x} value={x} lang={x}>
              {t(`language.name.${x}`)}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end md:col-span-3">
          <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

const MAX_COUNTER_START = 999_999_999;
const startSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}$/, msg('validation.integerRange', { min: 1, max: MAX_COUNTER_START }))
  .transform(Number)
  .refine((n) => n >= 1, msg('validation.integerRange', { min: 1, max: MAX_COUNTER_START }));
const numberingSchema = z.object({ caseNo: startSchema, invoiceNo: startSchema });
type NumberingIn = z.input<typeof numberingSchema>;
type NumberingOut = z.output<typeof numberingSchema>;

function NumberingSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const n = settings.numbering;
  const lang = currentLanguage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<NumberingIn, unknown, NumberingOut>({
    resolver: zodResolver(numberingSchema),
    values: { caseNo: String(n.caseNo.startValue), invoiceNo: String(n.invoiceNo.startValue) },
  });
  const save = useSaveSettings(
    (v: NumberingOut) =>
      settingsApi.numbering({
        ...(!n.caseNo.locked && v.caseNo !== n.caseNo.startValue ? { caseNoStart: v.caseNo } : {}),
        ...(!n.invoiceNo.locked && v.invoiceNo !== n.invoiceNo.startValue
          ? { invoiceNoStart: v.invoiceNo }
          : {}),
      }),
    'settings.saved',
    (e) => setFormError(applyServerErrors(e, form.setError, [])),
  );
  const { errors } = form.formState;
  const counter = (key: 'caseNo' | 'invoiceNo', label: string) => {
    const c = n[key];
    return (
      <div className="flex flex-col gap-2">
        <TextField
          label={label}
          inputMode="numeric"
          dir="ltr"
          className="num text-start"
          disabled={c.locked}
          hint={c.locked ? undefined : t('settings.startHint')}
          error={renderMessage(t, errors[key]?.message)}
          {...form.register(key)}
        />
        {c.locked && (
          <LockNote>{t('settings.numberLocked', { next: formatNumber(c.nextValue, lang) })}</LockNote>
        )}
      </div>
    );
  };
  const allLocked = n.caseNo.locked && n.invoiceNo.locked;
  return (
    <Section id="numbering" title={t('settings.numbering')} intro={t('settings.numberingIntro')}>
      <form
        noValidate
        aria-labelledby="numbering"
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <FormAlert>{formError}</FormAlert>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {counter('caseNo', t('settings.caseNoStart'))}
          {counter('invoiceNo', t('settings.invoiceNoStart'))}
        </div>
        {!allLocked && (
          <div>
            <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

function LogoSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const logoUrl = useLogoUrl(settings);
  const fileInput = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const upload = useSaveSettings(
    (file: File) => settingsApi.uploadLogo(file),
    'settings.logoUploaded',
    (e) => setProblem(e instanceof Error && 'code' in e ? e.message : null),
  );
  const remove = useMutation({
    mutationFn: () => settingsApi.removeLogo(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settingsKeys.all });
      setConfirmOpen(false);
      toast.success(t('settings.logoRemoved'));
    },
  });
  const onFile = async (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    const issue = await checkLogoFile(file);
    if (fileInput.current) fileInput.current.value = '';
    if (issue) {
      setProblem(
        issue === 'size'
          ? t('settings.logoTooLarge', { max: MAX_LOGO_BYTES / 1_048_576 })
          : t('settings.logoInvalidType'),
      );
      return;
    }
    upload.mutate(file);
  };
  return (
    <Section id="logo" title={t('settings.logo')} intro={t('settings.logoIntro')}>
      <div className="flex flex-wrap items-center gap-6">
        <div className="grid h-28 w-52 place-items-center overflow-hidden rounded-xl border border-dashed border-control bg-surface p-2">
          {logoUrl ? (
            <img src={logoUrl} alt={t('shell.logoAlt')} className="h-auto max-h-full w-auto max-w-full" />
          ) : (
            <span className="px-3 text-center text-[13px] text-muted">{t('settings.noLogo')}</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={fileInput}
            id="logo-file"
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            aria-label={t('settings.logo')}
            aria-describedby="logo-hint logo-problem"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <ImageUp aria-hidden="true" />
              {settings.logo.present ? t('settings.replaceLogo') : t('settings.uploadLogo')}
            </Button>
            {settings.logo.present && (
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                <Trash2 aria-hidden="true" />
                {t('settings.removeLogo')}
              </Button>
            )}
          </div>
          <p id="logo-hint" className="text-[13px] text-muted">
            {t('settings.logoHint')}
          </p>
          <p id="logo-problem" role="alert" className="text-[13.5px] font-semibold text-danger empty:hidden">
            {problem}
          </p>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('settings.removeLogoTitle')}
        body={t('settings.removeLogoBody')}
        confirmLabel={t('settings.removeLogo')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Section>
  );
}

export function GeneralSettingsPage() {
  const { data: settings } = useSuspenseQuery(settingsQuery);
  return (
    <div className="flex flex-col gap-4">
      <LabProfileSection settings={settings} />
      <LogoSection settings={settings} />
      <CurrencySection settings={settings} />
      <LanguageSection settings={settings} />
      <NumberingSection settings={settings} />
    </div>
  );
}
