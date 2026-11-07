import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n/i18n';
import { ShadeGuideDialog } from './ShadeGuideDialog';
import { CLASSIC_SHADES, shadeColor, THREE_D_SHADES } from './shades';

describe('ShadeGuideDialog', () => {
  beforeEach(async () => {
    await initI18n('ar');
  });

  it('picks a classic shade, with the screen-colour disclaimer shown', async () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(<ShadeGuideDialog open onOpenChange={onOpenChange} value={null} onChange={onChange} />);
    const dialog = screen.getByRole('dialog', { name: 'اختيار اللون' });
    expect(within(dialog).getByRole('tab', { name: 'الدليل الكلاسيكي' })).toHaveAttribute('aria-selected', 'true');
    expect(dialog).toHaveTextContent('ألوان الشاشة للإرشاد فقط وليست بديلًا عن دليل الألوان أو جهاز القياس.');
    expect(within(dialog).getByRole('button', { name: 'بدون لون' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'A2' }));
    expect(onChange).toHaveBeenCalledWith('A2');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens on the 3D-Master tab for a 3D code, and «بدون لون» clears the shade', async () => {
    const onChange = vi.fn();
    render(<ShadeGuideDialog open onOpenChange={vi.fn()} value="2M2" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: '3D-Master' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '2M2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'المستوى 0' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'بدون لون' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('switches tabs with the keyboard', async () => {
    render(<ShadeGuideDialog open onOpenChange={vi.fn()} value={null} onChange={vi.fn()} />);
    screen.getByRole('tab', { name: 'الدليل الكلاسيكي' }).focus();
    // Two tabs, looping: an arrow key moves to the other one.
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: '3D-Master' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('shade codes', () => {
  it('has the classic guide (16 + bleach) and 29 3D-Master codes, each with a colour', () => {
    const classic = CLASSIC_SHADES.flatMap((g) => g.shades.map((s) => s.code));
    expect(classic).toContain('A3.5');
    expect(classic.filter((c) => !c.startsWith('BL'))).toHaveLength(16);
    expect(THREE_D_SHADES.flatMap((g) => g.shades)).toHaveLength(29);
    expect(shadeColor('3M2')).toMatch(/^hsl/);
    expect(shadeColor('custom')).toBeNull();
  });
});
