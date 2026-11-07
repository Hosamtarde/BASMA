import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  ChequeIcon,
  DoctorsIcon,
  IncomingIcon,
  InvoiceIcon,
  OutgoingIcon,
  ScaleIcon,
  ToothIcon,
} from '@/components/icons';
import { formatNumber } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';

type CardKey = 'newCase' | 'incoming' | 'outgoing' | 'debts' | 'cheques' | 'invoice' | 'doctors';

interface CardDef {
  key: CardKey;
  icon: ReactNode;
  band: string;
  /** Route once the slice ships; absent = shown as «قريباً», not a link. */
  to?: string;
}

/**
 * The seven cards of direction A in its order. A card becomes a link when its slice ships
 * (add `to`); until then it is visibly unavailable, not focusable, and announced as disabled.
 */
const CARDS: readonly CardDef[] = [
  { key: 'newCase', icon: <ToothIcon />, band: 'bg-band-1', to: '/cases/new' },
  { key: 'incoming', icon: <IncomingIcon />, band: 'bg-band-2' },
  { key: 'outgoing', icon: <OutgoingIcon />, band: 'bg-band-3' },
  { key: 'debts', icon: <ScaleIcon />, band: 'bg-band-4' },
  { key: 'cheques', icon: <ChequeIcon />, band: 'bg-band-5' },
  { key: 'invoice', icon: <InvoiceIcon />, band: 'bg-band-6' },
  { key: 'doctors', icon: <DoctorsIcon />, band: 'bg-band-7', to: '/doctors' },
];

const card =
  'flex min-h-[214px] flex-col items-center overflow-hidden rounded-[46px_46px_12px_12px] border border-border bg-card px-2.5 pt-[18px] text-center text-ink no-underline';

/** «ماذا تريد أن تسجّل؟»: tall cards shaped like shade-guide tabs (direction A). */
export function ActionCards({ figures }: { figures: Partial<Record<CardKey, number | undefined>> }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  return (
    <section aria-labelledby="actions-title">
      <h2 id="actions-title" className="mt-[26px] mb-3 text-[16px] font-extrabold">
        {t('home.actions.title')}
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-4 xl:grid-cols-7">
        {CARDS.map((c) => {
          const figure = figures[c.key];
          const body = (
            <>
              <span
                className={cn(
                  'grid size-[54px] shrink-0 place-items-center rounded-full text-white [&_svg]:size-[26px]',
                  c.to ? 'knob' : 'bg-st-cancelled',
                )}
              >
                {c.icon}
              </span>
              <h3 className="mt-3 mb-1 text-[15px] leading-[1.35] font-extrabold">
                {t(`home.actions.${c.key}.title`)}
              </h3>
              <p className="mb-3 text-[12.5px] leading-normal text-muted">
                {t(`home.actions.${c.key}.body`)}
              </p>
              <span
                className={cn(
                  'mt-auto flex min-h-[58px] w-[calc(100%+20px)] flex-col items-center justify-center border-t border-border px-1.5 pt-2 pb-2.5',
                  c.to ? c.band : 'bg-surface',
                )}
              >
                {c.to ? (
                  figure !== undefined && (
                    <>
                      <b className="num block text-[15px] font-extrabold">{formatNumber(figure, lang)}</b>{' '}
                      <small className="text-[12px] text-muted">
                        {t(`home.actions.${c.key as 'newCase' | 'doctors'}.figure`)}
                      </small>
                    </>
                  )
                ) : (
                  <span className="rounded-full border border-border bg-card px-2.5 text-[12px] font-bold text-muted">
                    {t('home.actions.soon')}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={c.key} className="flex">
              {c.to ? (
                <Link
                  to={c.to}
                  data-card={c.key}
                  className={cn(
                    card,
                    'flex-1 transition-[transform,border-color] hover:-translate-y-[3px] hover:border-blue',
                  )}
                >
                  {body}
                </Link>
              ) : (
                // Not a link yet: no href, no tab stop, announced as an unavailable link.
                <div
                  role="link"
                  aria-disabled="true"
                  data-card={c.key}
                  className={cn(card, 'flex-1 cursor-default')}
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
