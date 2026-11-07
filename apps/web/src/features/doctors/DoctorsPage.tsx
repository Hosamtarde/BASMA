import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  ActiveBadge,
  Card,
  DataTable,
  PageHeader,
  Pager,
  SearchBox,
  StatusSelect,
  useListParams,
} from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { doctorApi, doctorKeys, doctorsQuery } from './api';
import type { Doctor } from './api';
import { DoctorFormDialog } from './DoctorFormDialog';

/** Doctors directory (SPEC §5.2). Case count and balance columns arrive with B3/B4. */
export function DoctorsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const list = useListParams();
  const { data } = useQuery(doctorsQuery({ search: list.search, active: list.active, page: list.page }));
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Doctor | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: doctorKeys.all });

  const remove = useMutation({
    mutationFn: (d: Doctor) => doctorApi.remove(d.id),
    onSuccess: async (outcome) => {
      await refresh();
      toast.success(outcome === 'deleted' ? t('doctors.deleted') : t('doctors.deactivated'));
      setDeleting(null);
    },
  });
  const reactivate = useMutation({
    mutationFn: (d: Doctor) => doctorApi.update(d.id, { rowVersion: d.rowVersion, active: true }),
    onSuccess: async () => {
      await refresh();
      toast.success(t('doctors.reactivated'));
    },
  });

  return (
    <>
      <PageHeader
        title={t('doctors.title')}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            {t('doctors.add')}
          </Button>
        }
      />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <SearchBox value={list.search} onChange={(q) => list.update({ q })} label={t('doctors.search')} />
          <StatusSelect value={list.status} onChange={(status) => list.update({ status })} />
        </div>
        <DataTable
          caption={t('doctors.title')}
          empty={(data?.items.length ?? 0) === 0}
          emptyText={list.search ? t('list.noResults') : t('doctors.empty')}
          head={
            <>
              <Th>{t('doctors.name')}</Th>
              <Th>{t('doctors.clinic')}</Th>
              <Th kind="number">{t('doctors.phone')}</Th>
              <Th>{t('list.status')}</Th>
              <Th kind="actions">
                <span className="sr-only">{t('list.actions')}</span>
              </Th>
            </>
          }
        >
          {data?.items.map((d) => (
            <tr key={d.id}>
              <Td autoDir>
                <Link
                  to={`/doctors/${d.id}`}
                  className="font-bold text-ink underline-offset-4 hover:underline"
                >
                  {d.name}
                </Link>
              </Td>
              <Td autoDir>{d.clinic}</Td>
              <Td kind="number">{d.phone}</Td>
              <Td>
                <ActiveBadge active={d.active} />
              </Td>
              <Td kind="actions">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('common.edit')}: ${d.name}`}
                  onClick={() => {
                    setEditing(d);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                {d.active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('common.delete')}: ${d.name}`}
                    onClick={() => setDeleting(d)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('list.reactivate')}: ${d.name}`}
                    onClick={() => reactivate.mutate(d)}
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
      </Card>
      <DoctorFormDialog doctor={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? t('doctors.deleteTitle', { name: deleting.name }) : ''}
        body={t('doctors.deleteBody')}
        confirmLabel={t('common.delete')}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}
