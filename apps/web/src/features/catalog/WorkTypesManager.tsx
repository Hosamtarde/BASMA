import { toMoneyInput } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { MoneyField, moneySchema } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { ConfirmDialog, FormDialog } from '@/components/ui/dialog';
import { FormAlert, TextField } from '@/components/ui/field';
import {
  ActiveBadge,
  DataTable,
  Pager,
  SearchBox,
  StatusSelect,
  useListParams,
  useLocalListParams,
} from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { useCurrency } from '@/features/shell/currency';
import { applyServerErrors, msg, renderMessage } from '@/lib/form-messages';
import { catalogKeys, workTypeApi, workTypesQuery } from './api';
import type { WorkType } from './api';

const NAME_MAX = 100;
const SORT_MAX = 10_000;

const formSchema = (decimals: number) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, msg('validation.required'))
      .max(NAME_MAX, msg('validation.maxLength', { max: NAME_MAX })),
    unitPrice: moneySchema(decimals),
    sortOrder: z
      .string()
      .trim()
      .regex(/^\d{1,5}$/, msg('validation.integerRange', { min: 0, max: SORT_MAX }))
      .transform(Number)
      .refine((n) => n <= SORT_MAX, msg('validation.integerRange', { min: 0, max: SORT_MAX })),
    active: z.boolean(),
  });
type FormIn = z.input<ReturnType<typeof formSchema>>;
type FormOut = z.output<ReturnType<typeof formSchema>>;

function WorkTypeDialog({
  item,
  open,
  onOpenChange,
}: {
  item: WorkType | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(formSchema(currency.decimals)),
    values: {
      name: item?.name ?? '',
      unitPrice: item ? toMoneyInput(item.unitPrice, currency.decimals) : '',
      sortOrder: String(item?.sortOrder ?? 0),
      active: item?.active ?? true,
    },
  });
  const { errors } = form.formState;
  const save = useMutation({
    mutationFn: (v: FormOut) =>
      item
        ? workTypeApi.update(item.id, {
            rowVersion: item.rowVersion,
            ...(v.name !== item.name ? { name: v.name } : {}),
            ...(v.unitPrice !== item.unitPrice ? { unitPrice: v.unitPrice } : {}),
            ...(v.sortOrder !== item.sortOrder ? { sortOrder: v.sortOrder } : {}),
            ...(v.active !== item.active ? { active: v.active } : {}),
          })
        : workTypeApi.create({ name: v.name, unitPrice: v.unitPrice, sortOrder: v.sortOrder }),
    meta: { inlineErrors: true },
    onSuccess: async () => {
      // Prices feed the currency lock and doctors' special-price lists.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.workTypes }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['doctors'] }),
      ]);
      toast.success(item ? t('workTypes.updated') : t('workTypes.created'));
      onOpenChange(false);
    },
    onError: (err) => setFormError(applyServerErrors(err, form.setError, ['name', 'unitPrice', 'sortOrder'])),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? t('workTypes.edit') : t('workTypes.add')}
      description={t('workTypes.priceNote')}
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
        <TextField
          label={t('workTypes.name')}
          required
          dir="auto"
          error={renderMessage(t, errors.name?.message)}
          {...form.register('name')}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MoneyField
            label={t('workTypes.unitPrice')}
            symbol={currency.symbol}
            required
            error={renderMessage(t, errors.unitPrice?.message)}
            {...form.register('unitPrice')}
          />
          <TextField
            label={t('workTypes.sortOrder')}
            hint={t('workTypes.sortOrderHint')}
            inputMode="numeric"
            dir="ltr"
            className="num text-start"
            error={renderMessage(t, errors.sortOrder?.message)}
            {...form.register('sortOrder')}
          />
        </div>
        {item && (
          <CheckboxField
            label={t('list.activeLabel')}
            hint={t('list.activeHint')}
            {...form.register('active')}
          />
        )}
        <div className="flex gap-2.5">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

/**
 * The work-types manager (SPEC §5.4): one component for its settings page and, in F2, for the
 * «⚙ أنواع العمل» modal of the case form. Editing a price affects only new case lines.
 */
export function WorkTypesManager({ inDialog = false }: { inDialog?: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  // On its page the list state is in the URL; inside a dialog it must not touch the page's URL.
  const urlList = useListParams();
  const localList = useLocalListParams();
  const list = inDialog ? localList : urlList;
  const { data } = useQuery(workTypesQuery({ search: list.search, active: list.active, page: list.page }));
  const [editing, setEditing] = useState<WorkType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<WorkType | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: catalogKeys.workTypes });

  const remove = useMutation({
    mutationFn: (w: WorkType) => workTypeApi.remove(w.id),
    onSuccess: async (outcome) => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['doctors'] })]);
      toast.success(outcome === 'deleted' ? t('workTypes.deleted') : t('workTypes.deactivated'));
      setDeleting(null);
    },
  });
  const reactivate = useMutation({
    mutationFn: (w: WorkType) => workTypeApi.update(w.id, { rowVersion: w.rowVersion, active: true }),
    onSuccess: async () => {
      await refresh();
      toast.success(t('workTypes.reactivated'));
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={list.search} onChange={(q) => list.update({ q })} label={t('workTypes.search')} />
        <StatusSelect value={list.status} onChange={(status) => list.update({ status })} />
        <span className="flex-1" />
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus aria-hidden="true" />
          {t('workTypes.add')}
        </Button>
      </div>
      <DataTable
        caption={t('workTypes.title')}
        empty={(data?.items.length ?? 0) === 0}
        emptyText={list.search ? t('list.noResults') : t('workTypes.empty')}
        head={
          <>
            <Th>{t('workTypes.name')}</Th>
            <Th kind="money">{t('workTypes.unitPriceWithSymbol', { symbol: currency.symbol })}</Th>
            <Th kind="number">{t('workTypes.sortOrder')}</Th>
            <Th>{t('list.status')}</Th>
            <Th kind="actions">
              <span className="sr-only">{t('list.actions')}</span>
            </Th>
          </>
        }
      >
        {data?.items.map((w) => (
          <tr key={w.id}>
            <Td className="font-bold">
              <span dir="auto">{w.name}</span>
            </Td>
            <Td kind="money">{currency.format(w.unitPrice)}</Td>
            <Td kind="number">{w.sortOrder}</Td>
            <Td>
              <ActiveBadge active={w.active} />
            </Td>
            <Td kind="actions">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${t('common.edit')}: ${w.name}`}
                onClick={() => {
                  setEditing(w);
                  setDialogOpen(true);
                }}
              >
                <Pencil aria-hidden="true" />
              </Button>
              {w.active ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('common.delete')}: ${w.name}`}
                  onClick={() => setDeleting(w)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('list.reactivate')}: ${w.name}`}
                  onClick={() => reactivate.mutate(w)}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              )}
            </Td>
          </tr>
        ))}
      </DataTable>
      {data && (
        <Pager
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPage={(page) => list.update({ page })}
        />
      )}
      <WorkTypeDialog item={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? t('workTypes.deleteTitle', { name: deleting.name }) : ''}
        body={t('workTypes.deleteBody')}
        confirmLabel={t('common.delete')}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}
