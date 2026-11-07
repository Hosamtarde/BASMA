import { Tooltip } from 'radix-ui';
import { useId } from 'react';
import type { MouseEvent } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import type { ButtonProps } from './button';

/**
 * A button that stays visible when its action is not allowed now, and says why: it is marked
 * aria-disabled (still focusable, so keyboard users can reach the reason), the reason is its
 * accessible description, and a tooltip shows it on hover and focus.
 */
export function ActionButton({
  disabledReason,
  onClick,
  className,
  ...props
}: ButtonProps & { disabledReason?: string | null }) {
  const id = useId();
  if (!disabledReason) return <Button onClick={onClick} className={className} {...props} />;
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            {...props}
            aria-disabled="true"
            aria-describedby={id}
            className={cn(
              'cursor-not-allowed opacity-60 hover:bg-transparent hover:brightness-100',
              className,
            )}
            onClick={(e: MouseEvent<HTMLButtonElement>) => e.preventDefault()}
          />
        </Tooltip.Trigger>
        <span id={id} className="sr-only">
          {disabledReason}
        </span>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={6}
            className="z-50 max-w-64 rounded-lg bg-ink px-3 py-2 text-[13px] font-semibold text-white shadow-[var(--shadow-dialog)]"
          >
            {disabledReason}
            <Tooltip.Arrow className="fill-ink" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
