import { Ban, TriangleAlert } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { CLASSIC_SHADES, isThreeD, shadeColor, THREE_D_SHADES } from './shades';

/** A small crown silhouette filled with the (approximate) shade colour; decorative. */
export function ShadeSwatch({ color, className }: { color: string | null; className?: string }) {
  return (
    <svg viewBox="0 0 20 26" aria-hidden="true" className={cn('h-7 w-[22px] shrink-0', className)}>
      <rect x="6" y="0.5" width="8" height="4" rx="1" fill="#a7b4be" />
      <path
        d="M3 6 Q10 3.6 17 6 Q18.6 13 16.4 19 Q14.6 24.8 10 25 Q5.4 24.8 3.6 19 Q1.4 13 3 6 Z"
        fill={color ?? '#ffffff'}
        stroke="#a1916d"
        strokeWidth="0.8"
        strokeDasharray={color ? undefined : '1.6 1.2'}
      />
    </svg>
  );
}

/** The row «الأكثر استخدامًا»: what the parent knows about shade usage (loading, failed, or the list). */
export type FrequentShades =
  | { state: 'loading' }
  | { state: 'error'; onRetry: () => void }
  | { state: 'ready'; items: { shade: string; count: number }[] };

function FrequentRow({
  frequent,
  value,
  onPick,
}: {
  frequent: FrequentShades;
  value: string | null;
  onPick: (c: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="shade-frequent-title" className="mb-3 rounded-lg bg-surface px-3 py-2.5">
      <h3 id="shade-frequent-title" className="mb-1.5 text-[13.5px] font-extrabold">
        {t('shade.frequent')}
      </h3>
      {frequent.state === 'loading' ? (
        <Spinner label={t('common.loading')} />
      ) : frequent.state === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-[13.5px]">
          <span className="font-semibold text-danger">{t('shade.frequentError')}</span>
          <Button variant="secondary" size="sm" onClick={frequent.onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : frequent.items.length === 0 ? (
        <p className="text-[13.5px] text-muted">{t('shade.frequentEmpty')}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {frequent.items.map((i) => (
            <ShadeButton
              key={i.shade}
              shade={{ code: i.shade, color: shadeColor(i.shade) }}
              current={value}
              onPick={onPick}
              hint={t('shade.frequentCount', { n: i.count })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ShadeButton({
  shade,
  current,
  onPick,
  hint,
}: {
  shade: { code: string; color: string | null };
  current: string | null;
  onPick: (c: string) => void;
  /** Extra accessible description (the use count of the «most used» row). */
  hint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={current === shade.code}
      title={hint}
      onClick={() => onPick(shade.code)}
      className={cn(
        'flex w-[62px] flex-col items-center gap-1 rounded-lg border px-1 py-1.5 hover:bg-hover',
        current === shade.code ? 'border-blue bg-info-bg' : 'border-transparent',
      )}
    >
      <ShadeSwatch color={shade.color} />
      <span className="num text-[12.5px] font-extrabold">{shade.code}</span>
    </button>
  );
}

const tabClass =
  '-mb-px border-b-[3px] border-transparent px-4 py-2.5 text-[14.5px] font-bold text-muted hover:text-ink data-[state=active]:border-blue data-[state=active]:text-ink';

/**
 * Shade guide (SPEC §5.5): classic and 3D-Master tabs, «بدون لون», and the screen-colour
 * disclaimer. Picking returns the code (free text on the line, ≤ 20).
 */
export function ShadeGuideDialog({
  open,
  onOpenChange,
  value,
  onChange,
  frequent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: string | null;
  onChange: (code: string | null) => void;
  /** Shade usage for the top row; without it the row is not shown. */
  frequent?: FrequentShades;
}) {
  const { t } = useTranslation();
  const pick = (code: string | null) => {
    onChange(code);
    onOpenChange(false);
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t('shade.title')} wide>
      {frequent && <FrequentRow frequent={frequent} value={value} onPick={pick} />}
      <Tabs.Root defaultValue={isThreeD(value) ? '3d' : 'classic'}>
        <Tabs.List aria-label={t('shade.title')} className="flex border-b border-border">
          <Tabs.Trigger value="classic" className={tabClass}>
            {t('shade.classic')}
          </Tabs.Trigger>
          <Tabs.Trigger value="3d" className={tabClass}>
            {t('shade.threeD')}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="classic" className="flex flex-col gap-2 pt-3 outline-none">
          {CLASSIC_SHADES.map((g) => (
            <div
              key={g.group}
              role="group"
              aria-label={t(`shade.group.${g.group}`)}
              className="flex items-center gap-3"
            >
              <span className="w-36 shrink-0 text-[13.5px] font-bold">{t(`shade.group.${g.group}`)}</span>
              <div className="flex flex-wrap gap-1">
                {g.shades.map((s) => (
                  <ShadeButton key={s.code} shade={s} current={value} onPick={pick} />
                ))}
              </div>
            </div>
          ))}
        </Tabs.Content>
        <Tabs.Content value="3d" className="flex flex-col gap-2 pt-3 outline-none">
          {THREE_D_SHADES.map((g) => (
            <div
              key={g.level}
              role="group"
              aria-label={t('shade.level', { n: g.level })}
              className="flex items-center gap-3"
            >
              <span className="w-24 shrink-0 text-[13.5px] font-bold">
                {t('shade.level', { n: g.level })}
              </span>
              <div className="flex flex-wrap gap-1">
                {g.shades.map((s) => (
                  <ShadeButton key={s.code} shade={s} current={value} onPick={pick} />
                ))}
              </div>
            </div>
          ))}
        </Tabs.Content>
      </Tabs.Root>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          aria-pressed={value === null}
          onClick={() => pick(null)}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[14px] font-bold hover:bg-hover',
            value === null ? 'border-blue bg-info-bg' : 'border-control',
          )}
        >
          <Ban aria-hidden="true" className="size-4 text-muted" />
          {t('shade.none')}
        </button>
        <p className="flex flex-1 items-center gap-1.5 text-[13px] text-muted">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-warning-ink" />
          {t('shade.disclaimer')}
        </p>
      </div>
    </FormDialog>
  );
}
