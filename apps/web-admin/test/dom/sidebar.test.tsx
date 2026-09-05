import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PERMISSIONS } from '@klinara/shared';

const sessionState = { permissions: [] as string[], loading: false, me: null, reload: vi.fn() };

vi.mock('@/components/session/session-provider', () => ({
  useSession: () => sessionState,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/raporlar',
}));

const { Sidebar } = await import('../../src/components/shell/sidebar');
const { SidebarProvider } = await import('../../src/components/ui/sidebar');

function renderSidebar() {
  render(
    <SidebarProvider>
      <Sidebar />
    </SidebarProvider>,
  );
}

/*
 * Kenar çubuğu yeniden yazıldı (shadcn `Sidebar` üzerine, ikonlarla); "izni
 * olmayan öge RENDER EDİLMİYOR" kuralı o yeniden yazımda kaybolmamalı.
 */
describe('kenar çubuğu', () => {
  it('izni olmayan ögeyi hiç çizmiyor — gizlemiyor', () => {
    sessionState.permissions = [];
    sessionState.loading = false;
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Alan adları' })).not.toBeInTheDocument();
    // İzin gerektirmeyen "Hesabım" her rolde duruyor.
    expect(screen.getByRole('link', { name: 'Hesabım' })).toBeInTheDocument();
  });

  it('izin verilen ögeyi çiziyor', () => {
    sessionState.permissions = [PERMISSIONS.BOOKING_PAGE_READ];
    sessionState.loading = false;
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Alan adları' })).toBeInTheDocument();
  });

  it('bulunulan bölümü aria-current ile işaretliyor', () => {
    sessionState.permissions = [PERMISSIONS.APPOINTMENT_READ_ALL];
    sessionState.loading = false;
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Raporlar' })).toHaveAttribute('aria-current', 'page');
  });

  it('oturum yüklenirken menü yerine iskelet gösteriyor', () => {
    sessionState.permissions = [];
    sessionState.loading = true;
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Hesabım' })).not.toBeInTheDocument();
  });
});
