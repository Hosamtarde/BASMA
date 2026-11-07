import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkTypePicker, WorkTypesManagerDialog } from './pickers';
import type { WorkTypeOption } from './pickers';
import { ShadeGuideDialog, ShadeSwatch } from './shade/ShadeGuideDialog';
import { shadeColor } from './shade/shades';

/** «اللون»: the chosen code with its swatch, and a button that opens the shade guide. */
export function ShadeField({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  const { t } = useTranslation();
  const labelId = useId();
  const buttonId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={labelId} className="text-[14px] font-bold">
        {t('shade.field')}
      </span>
      <button
        id={buttonId}
        type="button"
        aria-labelledby={`${labelId} ${buttonId}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex h-10 items-center gap-2.5 rounded-lg border border-control bg-card px-2.5 text-start hover:bg-hover"
      >
        <ShadeSwatch color={value ? shadeColor(value) : null} className="h-6 w-[18px]" />
        <span className="num flex-1 font-extrabold">{value ?? t('shade.none')}</span>
        <span className="text-[13px] text-muted">{t('shade.change')}</span>
      </button>
      <ShadeGuideDialog open={open} onOpenChange={setOpen} value={value} onChange={onChange} />
    </div>
  );
}

/**
 * Work type, shade and «+ إضافة العمل للأسنان المحددة (n)»: one line per selected tooth.
 * The message (missing teeth or work type) is announced as an alert next to the button.
 */
export function WorkControls({
  workType,
  onWorkType,
  shade,
  onShade,
  selectedCount,
  onAdd,
  message,
  managerOpen,
  onManagerOpen,
}: {
  workType: WorkTypeOption | null;
  onWorkType: (w: WorkTypeOption | null) => void;
  shade: string | null;
  onShade: (s: string | null) => void;
  selectedCount: number;
  onAdd: () => void;
  message: string | null;
  managerOpen: boolean;
  onManagerOpen: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <WorkTypePicker value={workType} onChange={onWorkType} onManage={() => onManagerOpen(true)} />
        <ShadeField value={shade} onChange={onShade} />
      </div>
      <Button className="h-12 w-full text-[15px]" onClick={onAdd}>
        <Plus aria-hidden="true" />
        {t('newCase.addWork', { n: selectedCount })}
      </Button>
      {message && (
        <p role="alert" className="text-[13.5px] font-semibold text-danger">
          {message}
        </p>
      )}
      <WorkTypesManagerDialog open={managerOpen} onOpenChange={onManagerOpen} />
    </div>
  );
}
