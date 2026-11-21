import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The A4 sheet on screen: it scrolls sideways inside this frame on a narrow window, never the page (B5b
 * rule), and the frame is a focusable, named region so a keyboard user can scroll it (axe). When printing,
 * the frame disappears and only the document is printed.
 */
export function DocumentFrame({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be focusable (axe: scrollable-region-focusable)
      tabIndex={0}
      className={cn('inv-frame inv-print-root focus-visible:outline-2 focus-visible:outline-cyan', className)}
      data-document-frame=""
    >
      {children}
    </div>
  );
}
