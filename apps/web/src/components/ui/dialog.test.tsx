import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@/i18n/i18n';
import { FormDialog } from './dialog';

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <FormDialog open={open} onOpenChange={setOpen} title="title">
        <input aria-label="inside" />
      </FormDialog>
    </>
  );
}

describe('FormDialog', () => {
  beforeEach(async () => {
    await initI18n('en');
  });

  it('opened by state, it gives the focus back to the control that opened it (Esc and the close button)', async () => {
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'open' });
    await userEvent.click(opener);
    expect(await screen.findByRole('dialog', { name: 'title' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());

    await userEvent.click(opener);
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
