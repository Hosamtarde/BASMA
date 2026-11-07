import { parseMoney, toMoneyInput } from '@app/shared';
import type { MoneyParseError } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowLeft, Pencil, RotateCcw, Star, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { NotFoundPage } from '@/app/errors';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/field';
import { ActiveBadge, Card, DataTable } from '@/components/ui/list';
import { useCurrency } from '@/features/shell/currency';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import { msg, rawMsg, renderMessage } from '@/lib/form-messages';
import { doctorApi, doctorKeys, doctorPricesQuery, doctorQuery } from './api';
import type { Doctor, DoctorPrice } from './api';
import { DoctorFormDialog } from './DoctorFormDialog';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    '-mb-px border-b-[3px] px-4 py-2.5 text-[14.5px] font-bold no-underline',
    isActive ? 'border-blue text-ink' : 'border-transparent text-muted hover:text-ink',
  );

/** Doctor account page (SPEC §5.2, §5.12): Info and Special prices. Payments and statement come later. */
export function DoctorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = Number(useParams().id);
  const valid = Number.isSafeInteger(id) && id > 0;
  const { data: doctor } = useQuery({ ...doctorQuery(id), enabled: valid });
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const Back = currentLanguage() === 'ar' ? ArrowRight : ArrowLeft;

  const remove = useMutation({
    mutationFn: () => doctorApi.remove(id),
    onSuccess: async (outcome) => {
      await queryClient.invalidateQueries({ queryKey: doctorKeys.all });
      setDeleteOpen(false);
      if (outcome === 'deleted') {
        toast.success(t('doctors.deleted'));
        void navigate('/doctors', { replace: true });
      } else {
        toast.success(t('doctors.deactivated'));
      }
    },
  });
  const reactivate = useMutation({
    mutationFn: (d: Doctor) => doctorApi.update(d.id, { rowVersion: d.rowVersion, active: true }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(doctorKeys.one(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: doctorKeys.all });
      toast.success(t('doctors.reactivated'));
    },
  });

  if (!valid) return <NotFoundPage />;
  if (!doctor) return <Spinner label={t('common.loading')} />;

  return (
    <>
      <Link
        to="/doctors"
        className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-bold text-cyan-ink no-underline hover:underline"
      >
        <Back aria-hidden="true" className="size-4" />
        {t('doctors.backToList')}
      </Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-3">
        <h1 dir="auto" className="text-[24px] leading-tight font-extrabold">
          {doctor.name}
        </h1>
        <ActiveBadge active={doctor.active} />
        <span className="flex-1" />
        <Button variant="secondary" onClick={() => setEditOpen(true)}>
          <Pencil aria-hidden="true" />
          {t('common.edit')}
        </Button>
        {doctor.active ? (
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden="true" />
            {t('common.delete')}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => reactivate.mutate(doctor)}>
            <RotateCcw aria-hidden="true" />
            {t('list.reactivate')}
          </Button>
        )}
      </div>
      <nav aria-label={t('doctors.sections')} className="mb-4 flex gap-1 border-b border-border">
        <NavLink to={`/doctors/${doctor.id}`} end className={tabClass}>
          {t('doctors.tabInfo')}
        </NavLink>
        <NavLink to={`/doctors/${doctor.id}/prices`} className={tabClass}>
          {t('doctors.tabPrices')}
        </NavLink>
      </nav>
      <Outlet context={doctor} />
      <DoctorFormDialog doctor={doctor} open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('doctors.deleteTitle', { name: doctor.name })}
        body={t('doctors.deleteBody')}
        confirmLabel={t('common.delete')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

export function DoctorInfoTab() {
  const { t } = useTranslation();
  const doctor = useOutletContext<Doctor>();
  const currency = useCurrency();
  const balance = doctor.openingBalance;
  const rows: [string, React.ReactNode][] = [
    [t('doctors.clinic'), <span dir="auto">{doctor.clinic ?? '—'}</span>],
    [t('doctors.phone'), <span className="num">{doctor.phone ?? '—'}</span>],
    [
      t('doctors.openingBalance'),
      <span>
        <span className="num font-bold">
          {currency.format(balance)} {currency.symbol}
        </span>
        {balance !== 0 && (
          <span className="ms-2 text-[13px] text-muted">
            {balance > 0 ? t('doctors.owesLab') : t('doctors.labOwes')}
          </span>
        )}
      </span>,
    ],
    [
      t('doctors.notes'),
      <span dir="auto" className="whitespace-pre-line">
        {doctor.notes ?? '—'}
      </span>,
    ],
  ];
  return (
    <Card>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[14px] font-bold text-muted">{label}</dt>
            <dd className="m-0">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const PRICE_ERROR: Record<MoneyParseError, (decimals: number) => string> = {
  empty: () => msg('validation.required'),
  format: () => msg('validation.moneyFormat'),
  tooManyDecimals: (d) => msg('validation.moneyDecimals', { count: d }),
  negative: () => msg('validation.moneyNegative'),
  tooLarge: () => msg('validation.moneyTooLarge'),
};

function PriceRow({ doctorId, row }: { doctorId: number; row: DoctorPrice }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const initial = row.specialPrice === null ? '' : toMoneyInput(row.specialPrice, currency.decimals);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const done = async (message: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: doctorKeys.prices(doctorId) }),
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
    ]);
    toast.success(message);
  };
  const save = useMutation({
    mutationFn: (minor: number) => doctorApi.setPrice(doctorId, row.workTypeId, minor),
    meta: { inlineErrors: true },
    onSuccess: () => done(t('prices.saved', { name: row.workTypeName })),
    onError: (e) => setError(e instanceof ApiError ? rawMsg(e.message) : null),
  });
  const clear = useMutation({
    mutationFn: () => doctorApi.clearPrice(doctorId, row.workTypeId),
    onSuccess: async () => {
      setText('');
      await done(t('prices.removed', { name: row.workTypeName }));
    },
  });
  const inputId = `price-${row.workTypeId}`;
  const submit = () => {
    const parsed = parseMoney(text, currency.decimals);
    if (!parsed.ok) {
      setError(PRICE_ERROR[parsed.error](currency.decimals));
      return;
    }
    setError(null);
    save.mutate(parsed.minor);
  };
  const dirty = text.trim() !== initial;
  return (
    <tr>
      <td dir="auto" className="font-bold">
        {row.workTypeName}
        {!row.workTypeActive && (
          <span className="ms-2 text-[12.5px] font-semibold text-muted">{t('prices.inactiveType')}</span>
        )}
      </td>
      <td className="num">
        {currency.format(row.generalPrice)} {currency.symbol}
      </td>
      <td>
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className="sr-only">
              {t('prices.specialFor', { name: row.workTypeName })}
            </label>
            <div className="relative">
              <input
                id={inputId}
                value={text}
                onChange={(e) => setText(e.target.value)}
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${inputId}-error` : undefined}
                className="num h-9 w-36 rounded-lg border border-control bg-card px-3 pe-9 text-start outline-none focus-visible:outline-2 focus-visible:outline-focus aria-[invalid=true]:border-danger"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-[13px] text-muted"
              >
                {currency.symbol}
              </span>
            </div>
            {error && (
              <p id={`${inputId}-error`} className="max-w-56 text-[12.5px] font-semibold text-danger">
                {renderMessage(t, error)}
              </p>
            )}
          </div>
          <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </td>
      <td>
        {row.specialPrice !== null ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-warning-bg px-2 py-0.5 text-[12.5px] font-bold whitespace-nowrap text-warning-ink">
            <Star aria-hidden="true" className="size-3.5" />
            {t('prices.special')}
          </span>
        ) : (
          <span className="text-[13px] whitespace-nowrap text-muted">{t('prices.usesGeneral')}</span>
        )}
      </td>
      <td className="w-0 whitespace-nowrap">
        {row.specialPrice !== null && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('prices.remove', { name: row.workTypeName })}
            onClick={() => clear.mutate()}
          >
            <Undo2 aria-hidden="true" />
          </Button>
        )}
      </td>
    </tr>
  );
}

/** Special prices (SPEC §5.12): used for new case lines only; existing lines keep their price. */
export function DoctorPricesTab() {
  const { t } = useTranslation();
  const doctor = useOutletContext<Doctor>();
  const currency = useCurrency();
  const { data } = useQuery(doctorPricesQuery(doctor.id));
  if (!data) return <Spinner label={t('common.loading')} />;
  return (
    <Card>
      <p className="mb-3 text-[14px] text-muted">{t('prices.intro')}</p>
      <DataTable
        caption={t('prices.caption', { name: doctor.name })}
        empty={data.length === 0}
        emptyText={t('prices.noWorkTypes')}
        head={
          <>
            <th scope="col">{t('workTypes.name')}</th>
            <th scope="col">{t('prices.general')}</th>
            <th scope="col">{t('prices.specialWithSymbol', { symbol: currency.symbol })}</th>
            <th scope="col">{t('prices.applies')}</th>
            <th scope="col" className="w-0">
              <span className="sr-only">{t('list.actions')}</span>
            </th>
          </>
        }
      >
        {data.map((row) => (
          // Keyed by the saved price so the box resets after a save or removal.
          <PriceRow
            key={`${row.workTypeId}:${row.specialPrice ?? 'general'}`}
            doctorId={doctor.id}
            row={row}
          />
        ))}
      </DataTable>
      {data.length === 0 && (
        <p className="mt-3 text-[14px]">
          <Link to="/settings/work-types" className="font-bold text-cyan-ink">
            {t('prices.manageWorkTypes')}
          </Link>
        </p>
      )}
    </Card>
  );
}
