import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/list';
import {
  catalogKeys,
  expenseCategoriesQuery,
  expenseCategoryApi,
  technicianApi,
  techniciansQuery,
} from '@/features/catalog/api';
import { NameListManager } from '@/features/catalog/NameListManager';
import { WorkTypesManager } from '@/features/catalog/WorkTypesManager';

function Section({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="text-[18px] font-extrabold">{title}</h2>
      <p className="mt-1 mb-4 text-[14px] text-muted">{intro}</p>
      {children}
    </Card>
  );
}

export function WorkTypesPage() {
  const { t } = useTranslation();
  return (
    <Section title={t('workTypes.title')} intro={t('workTypes.intro')}>
      <WorkTypesManager />
    </Section>
  );
}

export function TechniciansPage() {
  const { t } = useTranslation();
  return (
    <Section title={t('technicians.title')} intro={t('technicians.intro')}>
      <NameListManager
        queryKey={catalogKeys.technicians}
        listQuery={techniciansQuery}
        create={technicianApi.create}
        update={technicianApi.update}
        remove={technicianApi.remove}
        labels={{
          add: t('technicians.add'),
          edit: t('technicians.edit'),
          name: t('technicians.name'),
          search: t('technicians.search'),
          caption: t('technicians.title'),
          empty: t('technicians.empty'),
          created: t('technicians.created'),
          updated: t('technicians.updated'),
          deleted: t('technicians.deleted'),
          deactivated: t('technicians.deactivated'),
          reactivated: t('technicians.reactivated'),
          deleteTitle: (name) => t('technicians.deleteTitle', { name }),
          deleteBody: t('technicians.deleteBody'),
        }}
      />
    </Section>
  );
}

export function ExpenseCategoriesPage() {
  const { t } = useTranslation();
  return (
    <Section title={t('expenseCategories.title')} intro={t('expenseCategories.intro')}>
      <NameListManager
        queryKey={catalogKeys.expenseCategories}
        listQuery={expenseCategoriesQuery}
        create={expenseCategoryApi.create}
        update={expenseCategoryApi.update}
        remove={expenseCategoryApi.remove}
        labels={{
          add: t('expenseCategories.add'),
          edit: t('expenseCategories.edit'),
          name: t('expenseCategories.name'),
          search: t('expenseCategories.search'),
          caption: t('expenseCategories.title'),
          empty: t('expenseCategories.empty'),
          created: t('expenseCategories.created'),
          updated: t('expenseCategories.updated'),
          deleted: t('expenseCategories.deleted'),
          deactivated: t('expenseCategories.deactivated'),
          reactivated: t('expenseCategories.reactivated'),
          deleteTitle: (name) => t('expenseCategories.deleteTitle', { name }),
          deleteBody: t('expenseCategories.deleteBody'),
          system: t('expenseCategories.system'),
          systemHint: t('expenseCategories.systemHint'),
        }}
      />
    </Section>
  );
}
