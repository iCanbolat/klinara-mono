import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('@/lib/api/client', () => ({ api: { get, post, patch }, ApiProblemError, SessionExpiredError }));

let permissions: string[] = [PERMISSIONS.APPOINTMENT_WRITE];
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me: null, loading: false }),
}));

const { AppointmentSheet } = await import('../../src/components/calendar/appointment-sheet');

const APPOINTMENT = {
  id: 'a1',
  tenantId: 't1',
  branchId: 'b1',
  customerId: 'c1',
  status: 'scheduled',
  startsAt: '2026-09-07T10:00:00+03:00',
  endsAt: '2026-09-07T10:30:00+03:00',
  origin: 'internal',
  notes: null,
  cancellationReason: null,
  version: 3,
  totalMinor: 50000,
  createdAt: '2026-09-01T10:00:00+03:00',
  services: [
    {
      id: 'l1',
      serviceId: 's1',
      staffProfileId: 'p1',
      sortOrder: 0,
      startsAt: '2026-09-07T10:00:00+03:00',
      endsAt: '2026-09-07T10:30:00+03:00',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      priceMinor: 50000,
      vatRateBasisPoints: 2000,
      customerPackageItemId: null,
    },
  ],
};

const detailCalls = (): number =>
  get.mock.calls.filter((call) => call[0] === 'appointments/a1').length;

function renderSheet() {
  const onChanged = vi.fn();
  render(
    <AppointmentSheet
      appointmentId="a1"
      timezone="Europe/Istanbul"
      onClose={vi.fn()}
      onChanged={onChanged}
    />,
  );
  return { onChanged };
}

describe('randevu ayrıntı paneli', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    permissions = [PERMISSIONS.APPOINTMENT_WRITE];
    get.mockImplementation((path: string) => {
      if (path === 'appointments/a1') return Promise.resolve(APPOINTMENT);
      if (path === 'appointments/a1/history') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    post.mockResolvedValue(undefined);
    patch.mockResolvedValue({ ...APPOINTMENT, version: 4, notes: 'yeni' });
  });

  it('DURUM DEĞİŞTİRDİKTEN sonra randevuyu YENİDEN OKUYOR', async () => {
    // ⚠️ REGRESYON KİLİDİ (plan A2).
    // `POST /appointments/:id/status` kaydı değiştirip `version`ı artırıyor
    // ama ETag DÖNMÜYOR ve If-Match İSTEMİYOR. Yeniden okunmazsa istemcinin
    // elindeki sürüm sessizce bayatlar ve kullanıcı KENDİ yaptığı işlemden
    // sonra notu düzenlemeye kalktığında 409 yer.
    //
    // Sunucuya ETag eklendiğinde bu telafi kaldırılabilir; o zamana kadar
    // kilit burada.
    const user = userEvent.setup();
    renderSheet();

    await screen.findByRole('button', { name: 'Onaylandı' });
    const before = detailCalls();

    await user.click(screen.getByRole('button', { name: 'Onaylandı' }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('appointments/a1/status', { status: 'confirmed' });
    });
    await waitFor(() => {
      expect(detailCalls()).toBeGreaterThan(before);
    });
  });

  it('İPTALDEN sonra da yeniden okuyor', async () => {
    // Aynı gerekçe: `cancel` de ETag döndürmüyor.
    const user = userEvent.setup();
    renderSheet();

    await screen.findByRole('button', { name: 'İptal et' });
    const before = detailCalls();

    await user.click(screen.getByRole('button', { name: 'İptal et' }));
    await user.click(await screen.findByRole('button', { name: 'İptal et', hidden: false }));

    await waitFor(() => {
      expect(post.mock.calls.some((c) => c[0] === 'appointments/a1/cancel')).toBe(true);
    });
    await waitFor(() => {
      expect(detailCalls()).toBeGreaterThan(before);
    });
  });

  it('not güncellemesi `If-Match` GÖNDERİYOR', async () => {
    // `PATCH` başlıksız istekte 428 döner ve kullanıcı 428 GÖRMEMELİ —
    // o bir istemci hatasıdır.
    const user = userEvent.setup();
    renderSheet();

    const textarea = await screen.findByLabelText('Not');
    await user.type(textarea, 'ilk seans');
    await user.click(screen.getByRole('button', { name: 'Notu kaydet' }));

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith(
        'appointments/a1',
        { notes: 'ilk seans' },
        { ifMatch: 'W/"3"' },
      );
    });
  });

  it('BOŞ not `null` olarak gönderiliyor', async () => {
    // `''` ile "not yok" aynı şey değil; boş dize bir not olarak saklanırdı.
    const user = userEvent.setup();
    renderSheet();

    await screen.findByLabelText('Not');
    await user.click(screen.getByRole('button', { name: 'Notu kaydet' }));

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('appointments/a1', { notes: null }, expect.anything());
    });
  });

  it('`completed` randevuda geri alma düğmesi İZİNSİZKEN ETKİSİZ', async () => {
    // Düğme LİSTEDEN ÇIKARILMIYOR: hiç göstermemek "böyle bir şey yapılamaz"
    // derdi. Etkisiz ve sebebi yazılı bir düğme "yetkiniz yok" der.
    get.mockImplementation((path: string) => {
      if (path === 'appointments/a1') return Promise.resolve({ ...APPOINTMENT, status: 'completed' });
      if (path === 'appointments/a1/history') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    renderSheet();

    const button = await screen.findByRole('button', { name: 'İşlemde' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('yetkiniz yok'));
    expect(post).not.toHaveBeenCalled();
  });

  it('`appointment:reopen` varken geri alma ETKİN', async () => {
    permissions = [PERMISSIONS.APPOINTMENT_WRITE, PERMISSIONS.APPOINTMENT_REOPEN];
    get.mockImplementation((path: string) => {
      if (path === 'appointments/a1') return Promise.resolve({ ...APPOINTMENT, status: 'completed' });
      if (path === 'appointments/a1/history') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    renderSheet();

    expect(await screen.findByRole('button', { name: 'İşlemde' })).toBeEnabled();
  });
});
