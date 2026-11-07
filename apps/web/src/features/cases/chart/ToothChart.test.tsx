import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n/i18n';
import type { ToothWork } from '../draft';
import type { ChartView } from './geometry';
import { selectionReducer } from './selection';
import { ToothChartPanel, useChartView } from './ToothChart';

function Harness({
  work = new Map(),
  onArchWork,
  initial = [],
}: {
  work?: Map<number, ToothWork>;
  onArchWork?: (a: string) => void;
  initial?: number[];
}) {
  const [selection, dispatch] = useReducer(selectionReducer, initial);
  const [view, setView] = useState<ChartView>('mouth');
  return (
    <ToothChartPanel
      view={view}
      onViewChange={setView}
      selection={selection}
      dispatch={dispatch}
      work={work}
      legend={[...work.values()].map((w) => ({ name: w.names[0] ?? '', color: w.color }))}
      {...(onArchWork ? { onArchWork } : {})}
    />
  );
}

const tooth = (name: string | RegExp) => screen.getByRole('checkbox', { name });

describe('ToothChartPanel', () => {
  beforeEach(async () => {
    localStorage.clear();
    await initI18n('ar');
  });

  it('names every tooth in Arabic with its number, kind and the patient side', () => {
    render(<Harness />);
    const chart = screen.getByRole('group', { name: 'مخطط الأسنان' });
    expect(within(chart).getAllByRole('checkbox')).toHaveLength(32);
    expect(tooth('سن 13، ناب علوي يمين')).toHaveAttribute('aria-checked', 'false');
    expect(tooth('سن 36، رحى أولى سفلي يسار')).toBeInTheDocument();
    expect(tooth('سن 41، ثنية سفلي يمين')).toBeInTheDocument();
    expect(chart).toHaveAccessibleDescription(/الأسهم/);
  });

  it('keeps one tab stop (roving tabindex) and moves with the arrows as the eye sees the chart', async () => {
    render(<Harness />);
    const tabbable = screen.getAllByRole('checkbox').filter((el) => el.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    const t11 = tooth(/^سن 11،/);
    t11.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tooth(/^سن 21،/)).toHaveFocus();
    expect(tooth(/^سن 21،/)).toHaveAttribute('tabindex', '0');
    expect(t11).toHaveAttribute('tabindex', '-1');
    await userEvent.keyboard('{ArrowDown}');
    expect(tooth(/^سن 31،/)).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(tooth(/^سن 48،/)).toHaveFocus();
  });

  it('selects with Space and with a click, and shows removable chips', async () => {
    render(<Harness />);
    const t13 = tooth(/^سن 13،/);
    t13.focus();
    await userEvent.keyboard(' ');
    expect(t13).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(tooth(/^سن 23،/));
    expect(tooth(/^سن 23،/)).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('الأسنان المحددة:')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'إلغاء تحديد السن 13' }));
    expect(t13).toHaveAttribute('aria-checked', 'false');
    // Focus stays on the chips (the next one), not lost.
    expect(screen.getByRole('button', { name: 'إلغاء تحديد السن 23' })).toHaveFocus();
  });

  it('selects a quadrant (toggle), all and none', async () => {
    render(<Harness />);
    const q1 = screen.getByRole('button', { name: 'علوي يمين' });
    await userEvent.click(q1);
    expect(q1).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(8);
    await userEvent.click(q1);
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'تحديد الكل' }));
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(32);
    await userEvent.click(screen.getByRole('button', { name: 'مسح' }));
    expect(screen.getByText('لم تحدد أي سن بعد.')).toBeInTheDocument();
  });

  it('shows teeth with work in the work-type colour and names the work', () => {
    render(<Harness work={new Map([[11, { color: '#a65f0c', names: ['زيركون'] }]])} />);
    const t11 = tooth('سن 11، ثنية علوي يمين، عليه: زيركون');
    expect(t11).toHaveAttribute('data-work');
    expect(t11.getAttribute('style')).toContain('#a65f0c');
    expect(screen.getByText('زيركون')).toBeInTheDocument();
  });

  it('offers whole-arch work when asked and switches the chart model', async () => {
    const onArchWork = vi.fn();
    render(<Harness onArchWork={onArchWork} />);
    await userEvent.click(screen.getByRole('button', { name: 'الفكّان' }));
    expect(onArchWork).toHaveBeenCalledWith('both_arches');
    const rows = screen.getByRole('button', { name: 'منظر أمامي' });
    await userEvent.click(rows);
    expect(rows).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'مخطط الأسنان' })).toHaveAttribute('data-view', 'rows');
  });

  it('works the same in English (labels follow the language, geometry does not)', async () => {
    await initI18n('en');
    render(<Harness />);
    expect(tooth('Tooth 13, upper right canine')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upper right' })).toBeInTheDocument();
  });
});

describe('useChartView', () => {
  function View() {
    const [view, setView] = useChartView();
    return (
      <button type="button" onClick={() => setView(view === 'mouth' ? 'rows' : 'mouth')}>
        {view}
      </button>
    );
  }

  it('remembers the chosen model in this browser', async () => {
    localStorage.clear();
    const first = render(<View />);
    expect(screen.getByRole('button')).toHaveTextContent('mouth');
    await userEvent.click(screen.getByRole('button'));
    first.unmount();
    render(<View />);
    expect(screen.getByRole('button')).toHaveTextContent('rows');
  });
});
