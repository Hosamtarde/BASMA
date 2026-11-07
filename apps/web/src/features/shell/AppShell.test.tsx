import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';
import { LabBrand } from './LabBrand';

const labels = { sidebar: 'side', mainNav: 'main nav', skipToContent: 'skip' };

function renderShell(logoUrl: string | null, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell
        brand={<LabBrand name="مختبر الاختبار" logoUrl={logoUrl} logoAlt="logo of the lab" />}
        nav={[
          { to: '/', label: 'home', icon: <svg aria-hidden="true" />, end: true },
          { to: '/cases/new', label: 'new case', icon: <svg aria-hidden="true" /> },
          { to: '/cases', label: 'cases', icon: <svg aria-hidden="true" />, except: ['/cases/new'] },
        ]}
        topBarEnd={<button type="button">menu</button>}
        labels={labels}
      >
        <p>content</p>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('exposes the sidebar, one main navigation and the main region', () => {
    renderShell(null);
    expect(screen.getByRole('complementary', { name: 'side' })).toBeInTheDocument();
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('content');
    expect(screen.getByRole('link', { name: 'skip' })).toHaveAttribute('href', '#main');
  });

  it('marks the current page in the navigation', () => {
    renderShell(null);
    const nav = screen.getByRole('navigation', { name: 'main nav' });
    expect(within(nav).getByRole('link', { name: 'home' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'cases' })).not.toHaveAttribute('aria-current');
  });

  it('gives a path under another item to that item only (new case is not «cases»)', () => {
    renderShell(null, '/cases/new');
    expect(screen.getByRole('link', { name: 'new case' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'cases' })).not.toHaveAttribute('aria-current');
  });

  it('keeps a case page under «cases»', () => {
    renderShell(null, '/cases/12');
    expect(screen.getByRole('link', { name: 'cases' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'new case' })).not.toHaveAttribute('aria-current');
  });

  it('shows the lab name only when no logo is uploaded (never a vendor logo)', () => {
    renderShell(null);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('مختبر الاختبار')).toHaveAttribute('dir', 'auto');
  });

  it('shows the uploaded logo with its alt text', () => {
    renderShell('blob:http://127.0.0.1/abc');
    expect(screen.getByRole('img', { name: 'logo of the lab' })).toHaveAttribute(
      'src',
      'blob:http://127.0.0.1/abc',
    );
  });
});
