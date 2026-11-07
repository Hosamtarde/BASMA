import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  children: ReactNode;
}

const controlClass =
  'h-10 w-full min-w-0 rounded-lg border border-control bg-card px-3 text-ink outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-[invalid=true]:border-danger';

/** Label, control, hint and error with the ARIA links between them. */
function FieldShell({ id, label, hint, error, required, children }: FieldShellProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* The star sits beside the label so label text = accessible name (aria-required says it). */}
      <div className="flex items-baseline gap-1 text-[14px] font-bold">
        <label htmlFor={id}>{label}</label>
        {required && (
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[13px] text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  ref?: React.Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, required, className, ...input }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClass, className)}
        {...input}
      />
    </FieldShell>
  );
}

export function PasswordField({ label, hint, error, required, className, ...input }: TextFieldProps) {
  const id = useId();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          dir="ltr"
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(controlClass, 'pe-11 text-start', className)}
          {...input}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
          aria-pressed={visible}
          className="absolute inset-y-0 end-1 my-auto grid size-8 place-items-center rounded-md text-muted hover:bg-hover"
        >
          {visible ? (
            <EyeOff className="size-[18px]" aria-hidden="true" />
          ) : (
            <Eye className="size-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>
    </FieldShell>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  ref?: React.Ref<HTMLSelectElement>;
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  children,
  ...select
}: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClass, 'pe-8', className)}
        {...select}
      >
        {children}
      </select>
    </FieldShell>
  );
}

/** Form-level message (server answer that belongs to no single field). */
export function FormAlert({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-[14px] font-semibold text-danger"
    >
      {children}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-border border-t-blue"
      />
      <span>{label}</span>
    </span>
  );
}
