import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useUrlState } from './url-state';

interface S {
  status: string;
  overdue: boolean;
}
const parse = (p: URLSearchParams): S => ({ status: p.get('status') ?? '', overdue: p.get('overdue') === '1' });
const serialize = (s: S) => {
  const out = new URLSearchParams();
  if (s.status) out.set('status', s.status);
  if (s.overdue) out.set('overdue', '1');
  return out;
};

function Filters() {
  const [s, set] = useUrlState(parse, serialize);
  const { search } = useLocation();
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={s.overdue}
          onChange={(e) => set((p) => ({ ...p, overdue: e.target.checked }))}
        />
        overdue
      </label>
      <button
        type="button"
        onClick={() => {
          // Two changes in the same tick, before any navigation has rendered.
          set((p) => ({ ...p, status: 'ready' }));
          set((p) => ({ ...p, overdue: true }));
        }}
      >
        both
      </button>
      <output>{search}</output>
    </>
  );
}

const setup = (path = '/cases') => {
  const router = createMemoryRouter([{ path: '/cases', element: <Filters /> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

describe('useUrlState', () => {
  it('starts from the address', () => {
    setup('/cases?status=ready&overdue=1');
    expect(screen.getByRole('checkbox', { name: 'overdue' })).toBeChecked();
  });

  it('answers a click at once and mirrors it to the address', async () => {
    setup();
    const box = screen.getByRole('checkbox', { name: 'overdue' });
    await userEvent.click(box);
    expect(box).toBeChecked();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('?overdue=1'));
  });

  it('keeps both of two quick changes (none overwrites the other)', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'both' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('?status=ready&overdue=1'));
  });

  it('adopts a navigation made elsewhere (back/forward, a link)', async () => {
    const router = setup('/cases?overdue=1');
    await act(() => router.navigate('/cases?status=delivered'));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'overdue' })).not.toBeChecked());
    expect(screen.getByRole('status')).toHaveTextContent('?status=delivered');
  });
});
