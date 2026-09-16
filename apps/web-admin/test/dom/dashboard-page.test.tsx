import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PERMISSIONS } from '@klinara/shared';

const get = vi.fn();

class SessionExpiredError extends Error {}
class ApiProblemError extends Error {
  constructor(
    readonly problem: { code: string; status: number },
    readonly retryAfterSeconds: number | null,
  ) {
    super(problem.code);
  }
}

vi.mock('@/lib/api/client', () => ({ api: { get }, ApiProblemError, SessionExpiredError }));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// Grafik jsdom'da ölçü alamıyor; zaten `aria-hidden` ve verisi listede.
vi.mock('@/components/reports/report-chart', () => ({ ReportChart: () => null }));

const BRANCHES = [
  {
    id: 'b1',
    name: 'Kadıköy',
    timezone: 'Europe/Istanbul',
    isActive: true,
    address: 'Moda Cd. 1',
    phone: null,
  },
  {
    id: 'b2',
    name: 'Nişantaşı',
    timezone: 'Europe/Istanbul',
    isActive: true,
    address: null,
    phone: null,
  },
  {
    id: 'b3',
    name: 'Başka şube',
    timezone: 'Europe/Istanbul',
    isActive: true,
    address: null,
    phone: null,
  },
];

const setBranchId = vi.fn();
const branchState = {
  branches: BRANCHES,
  branchId: null,
  loading: false,
  canSelectAll: true,
  setBranchId,
};
vi.mock('@/components/session/branch-provider', () => ({ useBranch: () => branchState }));

let permissions: string[] = [];
let me = { user: { fullName: 'Deniz Ak' }, tenantWide: true, branchIds: [] as string[] };
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me, loading: false }),
}));

const { DashboardPage } = await import('../../src/components/dashboard/dashboard-page');

const SOON = new Date(Date.now() + 60 * 60_000).toISOString();

function calendar(branchId: string, names: string[]): unknown {
  return {
    branchId,
    timezone: 'Europe/Istanbul',
    from: '',
    to: '',
    density: [],
    appointments: names.map((name, index) => ({
      id: `${branchId}-${String(index)}`,
      branchId,
      customerId: 'c',
      customerName: name,
      customerPhone: null,
      status: 'scheduled',
      startsAt: SOON,
      endsAt: SOON,
      notes: null,
      version: 1,
      totalMinor: 0,
      services: [],
    })),
  };
}

function routes(overrides: Record<string, () => Promise<unknown>> = {}): void {
  get.mockImplementation((path: string) => {
    for (const [prefix, handler] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) return handler();
    }
    if (path.startsWith('calendar/day')) {
      const branchId = new URLSearchParams(path.split('?')[1]).get('branchId') ?? '';
      return Promise.resolve(
        calendar(branchId, branchId === 'b1' ? ['Ayşe Yılmaz', 'Can Er'] : []),
      );
    }
    if (path.startsWith('reports/occupancy')) {
      return Promise.resolve({
        totals: { occupancyRate: 64 },
        data: [{ groupId: 'b1', occupancyRate: 80 }],
        delta: { occupancyRate: 12 },
      });
    }
    if (path.startsWith('reports/no-show')) {
      return Promise.resolve({ totals: { noShowRate: 4 }, data: [] });
    }
    if (path.startsWith('reports/staff-performance')) {
      return Promise.resolve({
        scope: 'all',
        currency: 'TRY',
        data: [
          {
            staffProfileId: 'p1',
            staffName: 'Elif Uzman',
            revenueMinor: 90000,
            completedServices: 4,
          },
          {
            staffProfileId: 'p2',
            staffName: 'Zeynep Usta',
            revenueMinor: 160000,
            completedServices: 7,
          },
        ],
      });
    }
    if (path.startsWith('reports/revenue')) {
      return Promise.resolve({ totals: { accruedMinor: 250000, currency: 'TRY' }, data: [] });
    }
    return Promise.reject(new Error(`beklenmeyen istek: ${path}`));
  });
}

describe('karşılama sayfası', () => {
  beforeEach(() => {
    get.mockReset();
    push.mockReset();
    setBranchId.mockReset();
    me = { user: { fullName: 'Deniz Ak' }, tenantWide: true, branchIds: [] };
    permissions = [PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.REPORT_REVENUE_READ];
    routes();
  });

  it('şubeleri, bugünün toplamını ve aylık göstergeleri birleştiriyor', async () => {
    render(<DashboardPage />);

    expect(await screen.findByRole('rowheader', { name: 'Kadıköy' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Nişantaşı' })).toBeInTheDocument();
    // Şube grafiğinin erişilebilir tablosu: bugün 2, doluluk %80, rapor satırı olmayan şube %0.
    expect(screen.getByRole('rowheader', { name: 'Kadıköy' }).closest('tr')).toHaveTextContent(
      /2.*%80/,
    );
    expect(screen.getByRole('button', { name: 'Doluluk' })).toBeInTheDocument();
    expect(screen.getByText('Bugünkü randevu').closest('[data-slot=card]')).toHaveTextContent('2');
    expect(screen.getByText('Bu ay doluluk').closest('[data-slot=card]')).toHaveTextContent('%64');
    expect(screen.getByText(/Geçen aya göre \+12%/)).toBeInTheDocument();
    // Sıradaki randevular tüm şubelerden tek listede.
    expect(screen.getAllByText('Ayşe Yılmaz').length).toBeGreaterThan(0);
  });

  it('ŞUBE KAPSAMLI kullanıcı için erişemediği şubeye istek atmıyor', async () => {
    me = { user: { fullName: 'Deniz Ak' }, tenantWide: false, branchIds: ['b1'] };
    render(<DashboardPage />);

    await screen.findByRole('rowheader', { name: 'Kadıköy' });
    const dayCalls = get.mock.calls
      .map((c) => String(c[0]))
      .filter((p) => p.startsWith('calendar/day'));
    expect(dayCalls).toHaveLength(1);
    expect(dayCalls[0]).toContain('branchId=b1');
    expect(get.mock.calls.find((c) => String(c[0]).startsWith('calendar/day'))?.[1]).toMatchObject({
      branchId: 'b1',
    });
    expect(screen.queryByRole('rowheader', { name: 'Nişantaşı' })).not.toBeInTheDocument();
  });

  it('izni olmayan kaynağa istek atmıyor ve kartını çizmiyor', async () => {
    // Yalnız ciro izni: takvim bölümleri istek atmamalı.
    permissions = [PERMISSIONS.REPORT_REVENUE_READ];
    render(<DashboardPage />);

    expect(await screen.findByText('Bu ay ciro')).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalled());
    const paths = get.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.startsWith('calendar/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('reports/occupancy'))).toBe(false);
    expect(screen.queryByText('Bugünkü randevu')).not.toBeInTheDocument();
    expect(screen.queryByText('Sıradaki randevular')).not.toBeInTheDocument();
  });

  it('tek bir rapor düşerse diğer bölümler yine çalışıyor', async () => {
    routes({ 'reports/revenue': () => Promise.reject(new Error('ağ')) });
    render(<DashboardPage />);

    expect(await screen.findByText(/aylık özetler alınamadı/i)).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Kadıköy' })).toBeInTheDocument();
    expect(screen.getByText('Bu ay doluluk').closest('[data-slot=card]')).toHaveTextContent('%64');
  });

  it('personel cirosunu en çoktan aza listeliyor; karşılaştırma grafiği ve kısayollar yok', async () => {
    render(<DashboardPage />);

    const card = (await screen.findByRole('heading', { name: 'Personel cirosu' })).closest(
      '[data-slot=card]',
    );
    const names = [...(card?.querySelectorAll('li') ?? [])].map((li) => li.textContent ?? '');
    expect(names[0]).toContain('Zeynep Usta');
    expect(names[1]).toContain('Elif Uzman');
    expect(screen.queryByText(/şubelere göre/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Hızlı erişim')).not.toBeInTheDocument();
  });

  it('personel raporu yalnız dönemle isteniyor, uygulayıcıya da açık', async () => {
    permissions = [PERMISSIONS.APPOINTMENT_READ_OWN, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN];
    render(<DashboardPage />);

    await screen.findByRole('heading', { name: 'Personel cirosu' });
    const call = get.mock.calls
      .map((c) => String(c[0]))
      .find((p) => p.startsWith('reports/staff-performance'));
    expect(call).toBeDefined();
    expect(call).not.toContain('groupBy');
    expect(get.mock.calls.some((c) => String(c[0]).startsWith('reports/revenue'))).toBe(false);
  });

  it('sıradaki randevular şube grafiğinden ÖNCE geliyor', async () => {
    render(<DashboardPage />);

    const upcoming = await screen.findByRole('heading', { name: 'Sıradaki randevular' });
    const branches = await screen.findByRole('heading', { name: 'Şubeler' });
    expect(
      upcoming.compareDocumentPosition(branches) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('sıradaki randevudan takvime giderken şubeyi seçiyor', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<DashboardPage />);

    await user.click(await screen.findByRole('button', { name: /Ayşe Yılmaz/ }));
    expect(setBranchId).toHaveBeenCalledWith('b1');
    expect(push).toHaveBeenCalledWith('/takvim');
  });
});
