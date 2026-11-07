import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { ConfirmDialog, FormDialog } from '@/components/ui/dialog';
import { FormAlert, TextField } from '@/components/ui/field';
import { ActiveBadge, DataTable, Pager, SearchBox, StatusSelect, useListParams } from '@/components/ui/list';
import { applyServerErrors, msg, renderMessage } from '@/lib/form-messages';
import type { DeleteOutcome, ListParams } from './api';

export interface NamedItem {
  id: number;
  name: string;
  active: boolean;
  rowVersion: number;
  /** The system «doctor refund» expense category: rename only. */
  isDoctor?: boolean;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface NameListLabels {
  add: string;
  edit: string;
  name: string;
  search: string;
  caption: string;
  empty: string;
  created: string;
  updated: string;
  deleted: string;
  deactivated: string;
  reactivated: string;
  deleteTitle: (name: string) => string;
  deleteBody: string;
  system?: string;
  systemHint?: string;
}

interface NameListManagerProps<T extends NamedItem> {
  queryKey: readonly unknown[];
  /** A queryOptions factory returning Page<T> (typed loosely: TanStack's option types do not widen). */
  listQuery: (p: ListParams) => unknown;
  create: (name: string) => Promise<T>;
  update: (id: number, body: { rowVersion: number; name?: string; active?: boolean }) => Promise<T>;
  remove: (id: number) => Promise<DeleteOutcome>;
  labels: NameListLabels;
}

const NAME_MAX = 100;
const nameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, msg('validation.required'))
    .max(NAME_MAX, msg('validation.maxLength', { max: NAME_MAX })),
  active: z.boolean(),
});
type NameForm = z.infer<typeof nameSchema>;

function NameDialog<T extends NamedItem>({
  item,
  open,
  onOpenChange,
  props,
}: {
  item: T | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  props: NameListManagerProps<T>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<NameForm>({
    resolver: zodResolver(nameSchema),
    values: { name: item?.name ?? '', active: item?.active ?? true },
  });
  const save = useMutation({
    mutationFn: (v: NameForm) =>
      item
        ? props.update(item.id, {
            rowVersion: item.rowVersion,
            ...(v.name !== item.name ? { name: v.name } : {}),
            ...(v.active !== item.active ? { active: v.active } : {}),
          })
        : props.create(v.name),
    meta: { inlineErrors: true },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: props.queryKey });
      toast.success(item ? props.labels.updated : props.labels.created);
      onOpenChange(false);
    },
    onError: (err) => setFormError(applyServerErrors(err, form.setError, ['name'])),
  });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={item ? props.labels.edit : props.labels.add}>
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
          label={props.labels.name}
          required
          dir="auto"
          error={renderMessage(t, form.formState.errors.name?.message)}
          {...form.register('name')}
        />
        {item && (
          <CheckboxField
            label={t('list.activeLabel')}
            hint={item.isDoctor ? props.labels.systemHint : t('list.activeHint')}
            disabled={item.isDoctor}
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

/** Searchable, paged list with add/edit dialog and delete-or-deactivate (owner rule B1). */
export function NameListManager<T extends NamedItem>(props: NameListManagerProps<T>) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const list = useListParams();
  const { data } = useQuery(
    props.listQuery({ search: list.search, active: list.active, page: list.page }) as UseQueryOptions<
      Page<T>,
      Error,
      Page<T>,
      readonly unknown[]
    >,
  );
  const [editing, setEditing] = useState<T | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);
  const { labels } = props;

  const refresh = () => queryClient.invalidateQueries({ queryKey: props.queryKey });
  const remove = useMutation({
    mutationFn: (item: T) => props.remove(item.id),
    onSuccess: async (outcome) => {
      await refresh();
      toast.success(outcome === 'deleted' ? labels.deleted : labels.deactivated);
      setDeleting(null);
    },
  });
  const reactivate = useMutation({
    mutationFn: (item: T) => props.update(item.id, { rowVersion: item.rowVersion, active: true }),
    onSuccess: async () => {
      await refresh();
      toast.success(labels.reactivated);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={list.search} onChange={(q) => list.update({ q })} label={labels.search} />
        <StatusSelect value={list.status} onChange={(status) => list.update({ status })} />
        <span className="flex-1" />
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus aria-hidden="true" />
          {labels.add}
        </Button>
      </div>
      <DataTable
        caption={labels.caption}
        empty={(data?.items.length ?? 0) === 0}
        emptyText={labels.empty}
        head={
          <>
            <th scope="col">{labels.name}</th>
            <th scope="col">{t('list.status')}</th>
            <th scope="col" className="w-0">
              <span className="sr-only">{t('list.actions')}</span>
            </th>
          </>
        }
      >
        {data?.items.map((item) => (
          <tr key={item.id}>
            <td dir="auto" className="font-bold">
              {item.name}
              {item.isDoctor && labels.system && (
                <span className="ms-2 rounded-md bg-info-bg px-2 py-0.5 text-[12px] font-bold text-ink">
                  {labels.system}
                </span>
              )}
            </td>
            <td>
              <ActiveBadge active={item.active} />
            </td>
            <td className="whitespace-nowrap">
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('common.edit')}: ${item.name}`}
                  onClick={() => {
                    setEditing(item);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                {!item.active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('list.reactivate')}: ${item.name}`}
                    onClick={() => reactivate.mutate(item)}
                  >
                    <RotateCcw aria-hidden="true" />
                  </Button>
                )}
                {item.active && !item.isDoctor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('common.delete')}: ${item.name}`}
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </div>
            </td>
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
      <NameDialog item={editing} open={dialogOpen} onOpenChange={setDialogOpen} props={props} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? labels.deleteTitle(deleting.name) : ''}
        body={labels.deleteBody}
        confirmLabel={t('common.delete')}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}
