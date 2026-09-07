import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PERMISSIONS } from '@klinara/shared';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

class SessionExpiredError extends Error {}
class ApiProblemError extends Error {
  constructor(
    readonly problem: { code: string; status: number },
    readonly retryAfterSeconds: number | null,
  ) {
    super(problem.code);
  }
  get code(): string {
    return this.problem.code;
  }
}

vi.mock('@/lib/api/client', () => ({
  api: { get, post, patch },
  ApiProblemError,
  SessionExpiredError,
}));

let branchState: {
  branchId: string | null;
  loading: boolean;
  branches: never[];
  canSelectAll: boolean;
} = { branchId: 'b1', loading: false, branches: [], canSelectAll: true };
vi.mock('@/components/session/branch-provider', () => ({ useBranch: () => branchState }));

let permissions: string[] = [PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_WRITE];
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me: null, loading: false }),
}));

const { CalendarPage } = await import('../../src/components/calendar/calendar-page');
const { todayKey, weekStart } = await import('../../src/lib/calendar/date');

/**
 * Yoğunluk günü BUGÜNE göre türetiliyor, sabit yazılmıyor.
 *
 * Ekran açılışta `todayKey()`i kullanıyor; sabit bir tarih yazılsaydı test
 * yalnız o haftada yeşil kalır ve takvim ilerledikçe kodda hiçbir şey
 * değişmeden kırmızıya dönerdi. (10.1'de `availability.test.ts` tam olarak
 * böyle çürümüştü.)
 */
const THIS_WEEK_MONDAY = weekStart(todayKey('Europe/Istanbul'));

const CALENDAR = {
  branchId: 'b1',
  timezone: 'Europe/Istanbul',
  from: '2026-09-07T00:00:00+03:00',
  to: '2026-09-08T00:00:00+03:00',
  appointments: [
    {
      id: 'a1',
      branchId: 'b1',
      customerId: 'c1',
      customerName: 'Ayşe Yılmaz',
      customerPhone: null,
      status: 'scheduled',
      startsAt: '2026-09-07T10:00:00+03:00',
      endsAt: '2026-09-07T10:30:00+03:00',
      notes: null,
      version: 1,
      totalMinor: 50000,
      services: [
        {
          id: 'l1',
          serviceId: 's1',
          serviceName: 'Lazer',
          staffProfileId: 'p1',
          sortOrder: 0,
          startsAt: '2026-09-07T10:00:00+03:00',
          endsAt: '2026-09-07T10:30:00+03:00',
          priceMinor: 50000,
        },
      ],
    },
  ],
  density: [],
};

function mockRoutes(): void {
  get.mockImplementation((path: string) => {
    if (path.startsWith('calendar/')) return Promise.resolve(CALENDAR);
    if (path === 'services') return Promise.resolve({ data: [] });
    if (path === 'staff') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

describe('takvim ekranı', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    branchState = { branchId: 'b1', loading: false, branches: [], canSelectAll: true };
    permissions = [PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_WRITE];
    mockRoutes();
  });

  it('şube listesi YÜKLENİRKEN takvim isteği atmıyor', async () => {
    // İstek erken atılsaydı, şube çözüldüğünde ikinci bir istek daha giderdi
    // ve ilkinin yanıtı geç gelirse YANLIŞ şubenin takvimi ekrana basılırdı.
    branchState = { branchId: null, loading: true, branches: [], canSelectAll: true };
    render(<CalendarPage />);

    await waitFor(() => {
      expect(get.mock.calls.filter((call) => String(call[0]).startsWith('calendar/'))).toHaveLength(
        0,
      );
    });
  });

  it('şube seçili DEĞİLKEN istek atmıyor, seçim istiyor', () => {
    // `x-branch-id` başlıksız bir çağrı 400 döner ve kullanıcı sebebi
    // anlaşılmayan bir hata görürdü.
    branchState = { branchId: null, loading: false, branches: [], canSelectAll: true };
    render(<CalendarPage />);

    expect(get.mock.calls.filter((call) => String(call[0]).startsWith('calendar/'))).toHaveLength(0);
    expect(screen.getByText(/şube seçin/i)).toBeInTheDocument();
  });

  it('şubeyi HEM SORGUDA HEM BAŞLIKTA gönderiyor', async () => {
    // Uç `@RequireBranchScope()` taşıyor (başlık şart) ve DTO `branchId`
    // sorgu parametresini zorunlu tutuyor. Yalnız birini göndermek 400.
    render(<CalendarPage />);

    await waitFor(() => {
      const call = get.mock.calls.find((c) => String(c[0]).startsWith('calendar/day'));
      expect(call).toBeDefined();
      expect(String(call?.[0])).toContain('branchId=b1');
      expect(call?.[1]).toMatchObject({ branchId: 'b1' });
    });
  });

  it('randevuyu ızgarada gösteriyor', async () => {
    render(<CalendarPage />);
    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();
  });

  it('UYGULAYICI personel süzgecini görmüyor ve kapsam rozetini görüyor', async () => {
    // `read.own` taşıyan kullanıcı sunucuda zaten kendi randevularına
    // daraltılmış; ona bir personel süzgeci göstermek anlamsız bir kontrol.
    permissions = [PERMISSIONS.APPOINTMENT_READ_OWN, PERMISSIONS.APPOINTMENT_WRITE];
    render(<CalendarPage />);

    expect(await screen.findByText(/yalnız kendi randevularınızı/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /tüm personel/i })).not.toBeInTheDocument();
  });

  it('yazma izni YOKKEN yeni randevu düğmesi yok', async () => {
    permissions = [PERMISSIONS.APPOINTMENT_READ_ALL];
    render(<CalendarPage />);

    await screen.findByText('Ayşe Yılmaz');
    expect(screen.queryByRole('button', { name: /yeni randevu/i })).not.toBeInTheDocument();
  });

  it('gün görünümü VARSAYILAN ve hafta görünümü yoğunluk tablosu çiziyor', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    get.mockImplementation((path: string) => {
      if (path.startsWith('calendar/week')) {
        return Promise.resolve({
          ...CALENDAR,
          appointments: [],
          density: [{ localDay: THIS_WEEK_MONDAY, localHour: 10, appointmentCount: 3 }],
        });
      }
      if (path.startsWith('calendar/')) return Promise.resolve(CALENDAR);
      return Promise.resolve({ data: [] });
    });

    render(<CalendarPage />);
    await screen.findByText('Ayşe Yılmaz');

    await user.click(screen.getByRole('button', { name: 'Hafta' }));

    await waitFor(() => {
      expect(get.mock.calls.some((c) => String(c[0]).startsWith('calendar/week'))).toBe(true);
    });
    // Sayı hem renkte hem METİNDE: yalnız renge dayanmak erişilebilir değil.
    expect(await screen.findByRole('button', { name: /3 randevu/ })).toBeInTheDocument();
  });
});
