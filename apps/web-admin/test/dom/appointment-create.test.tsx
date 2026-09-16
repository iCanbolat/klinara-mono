import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@klinara/shared';

const get = vi.fn();
const post = vi.fn();

class SessionExpiredError extends Error {}
class ApiProblemError extends Error {
  constructor(
    readonly problem: { code: string; status: number } & Record<string, unknown>,
    readonly retryAfterSeconds: number | null,
  ) {
    super(problem.code);
  }
  get code(): string {
    return this.problem.code;
  }
}

vi.mock('@/lib/api/client', () => ({ api: { get, post }, ApiProblemError, SessionExpiredError }));

let permissions: string[] = [PERMISSIONS.APPOINTMENT_WRITE, PERMISSIONS.CUSTOMER_WRITE];
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me: null, loading: false }),
}));

const { CreateAppointmentDialog } = await import(
  '../../src/components/calendar/appointment-form/create-dialog'
);

const SERVICES = [
  {
    id: 's1',
    tenantId: 't1',
    categoryId: 'cat1',
    slug: 'lazer',
    name: 'Lazer',
    description: null,
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    priceMinor: 50000,
    vatRateBasisPoints: 2000,
    calendarColor: null,
    isOnlineBookable: true,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    branchOverrides: [],
  },
];

const STAFF = [
  {
    id: 'p1',
    tenantId: 't1',
    userId: 'u1',
    userFullName: 'Zeynep Kaya',
    userEmail: 'z@k.test',
    primaryBranchId: 'b1',
    branchIds: ['b1'],
    title: 'Uzman',
    specialties: [],
    calendarColor: null,
    bio: null,
    isVisibleOnline: true,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    services: [
      {
        id: 'ss1',
        tenantId: 't1',
        staffProfileId: 'p1',
        serviceId: 's1',
        branchId: null,
        customDurationMinutes: null,
        customPriceMinor: null,
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  },
];

const SLOT = '2026-12-07T10:00:00+03:00';
const SLOT_2 = '2026-12-07T11:00:00+03:00';

function renderDialog() {
  const onCreated = vi.fn();
  render(
    <CreateAppointmentDialog
      open
      branchId="b1"
      timezone="Europe/Istanbul"
      services={SERVICES}
      staff={STAFF}
      onClose={vi.fn()}
      onCreated={onCreated}
    />,
  );
  return { onCreated };
}

/** Müşteri → hizmet → personel → slot: gönderilebilir bir forma kadar. */
async function fillForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByRole('combobox', { name: /müşteri/i }), 'ayşe');
  await user.click(await screen.findByRole('option', { name: /Ayşe/ }));

  await user.selectOptions(screen.getByLabelText('Hizmet'), 's1');
  await user.selectOptions(screen.getByLabelText('Personel'), 'p1');

  await user.click(await screen.findByRole('button', { name: '10:00' }));
}

describe('randevu oluşturma', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    permissions = [PERMISSIONS.APPOINTMENT_WRITE, PERMISSIONS.CUSTOMER_WRITE];

    get.mockImplementation((path: string) => {
      if (path.startsWith('customers/search')) {
        return Promise.resolve([{ id: 'c1', fullName: 'Ayşe Yılmaz', phone: '+905321112233' }]);
      }
      if (path.startsWith('availability')) {
        return Promise.resolve({
          branchId: 'b1',
          timezone: 'Europe/Istanbul',
          slotGranularityMinutes: 30,
          slots: [
            { startsAt: SLOT, endsAt: '2026-12-07T10:30:00+03:00', staffProfileIds: ['p1'] },
            { startsAt: SLOT_2, endsAt: '2026-12-07T11:30:00+03:00', staffProfileIds: ['p1'] },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    post.mockResolvedValue({ id: 'a1' });
  });

  it('gönderim `Idempotency-Key` TAŞIYOR', async () => {
    // Projede bu başlığın İLK gerçek çağrı yeri; çift tıklamanın tek randevu
    // üretmesi buna bağlı.
    const user = userEvent.setup();
    renderDialog();
    await fillForm(user);

    await user.click(screen.getByRole('button', { name: 'Randevuyu oluştur' }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(1);
    });
    const options = post.mock.calls[0]?.[2] as { idempotencyKey?: string } | undefined;
    expect(options?.idempotencyKey).toBeTruthy();
  });

  it('SLOT DEĞİŞİNCE anahtar YENİLENİYOR', async () => {
    // Sunucu gövdeyi de hash'liyor: aynı anahtarla farklı gövde
    // `IDEMPOTENCY_CONFLICT` verirdi.
    const user = userEvent.setup();
    renderDialog();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Randevuyu oluştur' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const first = (post.mock.calls[0]?.[2] as { idempotencyKey?: string }).idempotencyKey;

    await user.click(screen.getByRole('button', { name: '11:00' }));
    await user.click(screen.getByRole('button', { name: 'Randevuyu oluştur' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const second = (post.mock.calls[1]?.[2] as { idempotencyKey?: string }).idempotencyKey;

    expect(second).not.toBe(first);
    expect(post.mock.calls[1]?.[1]).toMatchObject({ startsAt: SLOT_2 });
  });

  it('form TAMAMLANMADAN gönder düğmesi etkisiz', async () => {
    // Kısmi gövde kurup sunucudan 400 beklemek yerine düğme kapalı.
    renderDialog();
    expect(screen.getByRole('button', { name: 'Randevuyu oluştur' })).toBeDisabled();
  });

  it('`SLOT_CONFLICT` hata metni değil ALTERNATİF SAATLER gösteriyor', async () => {
    // Çakışma bir istisna değil, randevu almanın normal sonucu. Doğru yanıt
    // "hata" demek değil, sunucunun zaten hesapladığı önerileri göstermek.
    const user = userEvent.setup();
    post.mockRejectedValueOnce(
      new ApiProblemError(
        {
          code: 'SLOT_CONFLICT',
          status: 409,
          conflicts: [],
          suggestions: [
            { startsAt: SLOT_2, endsAt: '2026-12-07T11:30:00+03:00', staffProfileIds: ['p1'] },
          ],
        },
        null,
      ),
    );

    renderDialog();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Randevuyu oluştur' }));

    expect(await screen.findByText(/az önce doldu/i)).toBeInTheDocument();
    // Öneri bir DÜĞME — tıklanabilir bir kurtarma adımı, düz metin değil.
    const suggestions = await screen.findAllByRole('button', { name: '11:00' });
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('öneri YOKSA bunu söylüyor, sessiz kalmıyor', async () => {
    // Sunucu öneri üretimini `.catch(() => [])` ile koruyor; boş gelebilir.
    const user = userEvent.setup();
    post.mockRejectedValueOnce(
      new ApiProblemError(
        { code: 'SLOT_CONFLICT', status: 409, conflicts: [], suggestions: [] },
        null,
      ),
    );

    renderDialog();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Randevuyu oluştur' }));

    expect(await screen.findByText(/alternatif saat bulunamadı/i)).toBeInTheDocument();
  });

  it('alan hataları `fieldErrors`ten forma DÜŞÜYOR', async () => {
    // `describeProblem().fieldErrors` Faz 12'ye kadar hiçbir bileşenin
    // okumadığı ölü bir alandı.
    const user = userEvent.setup();
    post.mockRejectedValueOnce(
      new ApiProblemError(
        {
          code: 'VALIDATION_FAILED',
          status: 400,
          errors: [{ path: 'services.0.serviceId', message: 'Geçerli bir hizmet seçin' }],
        },
        null,
      ),
    );

    renderDialog();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Randevuyu oluştur' }));

    expect(await screen.findByText('Geçerli bir hizmet seçin')).toBeInTheDocument();
  });

  it('`customer:write` YOKKEN yeni müşteri yolu gösterilmiyor', async () => {
    // Uygulayıcı randevu açabilir ama müşteri yaratamaz; düğmeyi göstermek
    // tıklayınca 403 yemek demekti.
    const user = userEvent.setup();
    permissions = [PERMISSIONS.APPOINTMENT_WRITE];
    get.mockImplementation((path: string) =>
      path.startsWith('customers/search') ? Promise.resolve([]) : Promise.resolve({ data: [] }),
    );

    renderDialog();
    await user.type(screen.getByRole('combobox', { name: /müşteri/i }), 'yok');

    expect(await screen.findByText(/resepsiyona başvurun/i)).toBeInTheDocument();
  });
});
