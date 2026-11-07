import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '@/components/ui/list';
import { cn } from '@/lib/cn';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    '-mb-px border-b-[3px] px-4 py-2.5 text-[14.5px] font-bold whitespace-nowrap no-underline',
    isActive ? 'border-blue text-ink' : 'border-transparent text-muted hover:text-ink',
  );

/** Settings (SPEC §5.18) with the lists the lab maintains: technicians, work types, expense categories. */
export function SettingsLayout() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <nav
        aria-label={t('settings.sections')}
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
      >
        <NavLink to="/settings" end className={tabClass}>
          {t('settings.general')}
        </NavLink>
        <NavLink to="/settings/work-types" className={tabClass}>
          {t('workTypes.title')}
        </NavLink>
        <NavLink to="/settings/technicians" className={tabClass}>
          {t('technicians.title')}
        </NavLink>
        <NavLink to="/settings/expense-categories" className={tabClass}>
          {t('expenseCategories.title')}
        </NavLink>
      </nav>
      <Outlet />
    </>
  );
}
