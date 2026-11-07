import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cn } from '@/lib/cn';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Exact match only (the home route). */
  end?: boolean;
}

interface AppShellProps {
  brand: ReactNode;
  nav: NavItem[];
  /** Pinned to the bottom of the sidebar (e.g. settings, once its slice ships). */
  navBottom?: NavItem[];
  /** Right-hand items of the top bar in LTR / left-hand in RTL: language switch, user menu. */
  topBarEnd: ReactNode;
  labels: { sidebar: string; mainNav: string; skipToContent: string };
  children: ReactNode;
}

function NavEntry({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-[14.5px] font-semibold text-[#e3eff7] no-underline hover:bg-white/10 [&_svg]:size-5 [&_svg]:shrink-0',
          'before:absolute before:inset-y-2 before:-start-3.5 before:w-1 before:rounded-e before:content-[""]',
          isActive && 'bg-white/15 font-extrabold text-white before:bg-cyan',
        )
      }
    >
      {item.icon}
      <span>{item.label}</span>
    </NavLink>
  );
}

/**
 * Direction A shell: gradient sidebar on the reading-start side (right in Arabic), white top bar,
 * content on the surface colour. Layout uses logical properties only, so it mirrors in English.
 */
export function AppShell({ brand, nav, navBottom = [], topBarEnd, labels, children }: AppShellProps) {
  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[252px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2"
      >
        {labels.skipToContent}
      </a>
      <aside
        aria-label={labels.sidebar}
        className="bg-sidebar flex flex-col overflow-y-auto px-3.5 py-4 text-white md:sticky md:top-0 md:h-dvh"
      >
        {brand}
        <nav aria-label={labels.mainNav} className="flex flex-1 flex-col gap-0.5">
          {nav.map((item) => (
            <NavEntry key={item.to} item={item} />
          ))}
          {navBottom.length > 0 && (
            <div className="mt-auto flex flex-col gap-0.5 pt-4">
              {navBottom.map((item) => (
                <NavEntry key={item.to} item={item} />
              ))}
            </div>
          )}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-[65px] items-center gap-2.5 border-b border-border bg-card px-7">
          <span className="flex-1" />
          {topBarEnd}
        </header>
        <main id="main" tabIndex={-1} className="flex-1 px-4 pt-2 pb-24 outline-none md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
