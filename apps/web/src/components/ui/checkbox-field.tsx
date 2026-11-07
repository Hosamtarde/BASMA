import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
  hint?: string | undefined;
  ref?: React.Ref<HTMLInputElement>;
}

/** Native checkbox (keyboard and screen readers for free) with its label and optional hint. */
export function CheckboxField({ label, hint, ...input }: CheckboxFieldProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-1 size-[18px] shrink-0 accent-blue disabled:opacity-60"
        {...input}
      />
      <div>
        <label htmlFor={id} className="text-[14px] font-bold">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-[13px] text-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
