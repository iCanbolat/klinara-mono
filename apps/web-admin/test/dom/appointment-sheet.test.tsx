import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS, type Service } from '@klinara/shared';

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

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/takvim',
}));

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

// Panel yalnız `id` → `name` eşlemesi kullanıyor; gerisi test için gürültü.
const CATALOG = [{ id: 's1', name: 'Cilt bakımı' }] as Service[];

function renderSheet(
  services: Service[] = CATALOG,
  extra: Partial<React.ComponentProps<typeof AppointmentSheet>> = {},
) {
  const onChanged = vi.fn();
  render(
    <AppointmentSheet
      appointmentId="a1"
      timezone="Europe/Istanbul"
      services={services}
      {...extra}
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
    push.mockReset();
    permissions = [PERMISSIONS.APPOINTMENT_WRITE];
    get.mockImplementation((path: string) => {
      if (path === 'appointments/a1') return Promise.resolve(APPOINTMENT);
      if (path === 'appointments/a1/history') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    post.mockResolvedValue(undefined);
    patch.mockResolvedValue({ ...APPOINTMENT, version: 4, notes: 'yeni' });
  });

  it('hizmet satırında UUID değil hizmet ADI görünüyor', async () => {
    renderSheet();
    expect(await screen.findByText('Cilt bakımı')).toBeInTheDocument();
    expect(screen.queryByText('s1')).not.toBeInTheDocument();
  });

  it('katalogda olmayan (silinmiş) hizmet açık etiketle gösteriliyor', async () => {
    renderSheet([{ id: 'baska', name: 'Başka' }] as Service[]);
    expect(await screen.findByText('Silinmiş hizmet')).toBeInTheDocument();
  });

  it('katalog BOŞKEN (yükleniyor/hata) "silinmiş" DENMİYOR', async () => {
    renderSheet([]);
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Silinmiş hizmet')).not.toBeInTheDocument();
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

  describe('iptalde müşteriye bildirim', () => {
    const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const openCancel = async () => {
      const user = userEvent.setup();
      renderSheet();
      await user.click(await screen.findByRole('button', { name: 'İptal et' }));
      return user;
    };

    const cancelBody = () =>
      post.mock.calls.find((call) => call[0] === 'appointments/a1/cancel')?.[1] as
        | Record<string, unknown>
        | undefined;

    it('ileri tarihli randevuda kutu varsayılan işaretli; bayrak gövdeye girmiyor', async () => {
      get.mockImplementation((path: string) =>
        Promise.resolve(path === 'appointments/a1' ? { ...APPOINTMENT, startsAt: FUTURE } : { data: [] }),
      );
      const user = await openCancel();

      const checkbox = await screen.findByRole('checkbox', { name: 'Müşteriye bildir' });
      expect(checkbox).toBeChecked();
      await user.click(await screen.findByRole('button', { name: 'İptal et', hidden: false }));

      await waitFor(() => expect(cancelBody()).toEqual({}));
    });

    it('kutu kaldırılırsa `notifyCustomer: false` gider', async () => {
      get.mockImplementation((path: string) =>
        Promise.resolve(path === 'appointments/a1' ? { ...APPOINTMENT, startsAt: FUTURE } : { data: [] }),
      );
      const user = await openCancel();

      await user.click(await screen.findByRole('checkbox', { name: 'Müşteriye bildir' }));
      await user.click(await screen.findByRole('button', { name: 'İptal et', hidden: false }));

      await waitFor(() => expect(cancelBody()).toEqual({ notifyCustomer: false }));
    });

    it('geçmiş randevuda kutu hiç gösterilmez', async () => {
      await openCancel();
      await screen.findByRole('dialog');
      expect(screen.queryByRole('checkbox', { name: 'Müşteriye bildir' })).not.toBeInTheDocument();
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
  describe('durum şeridi ve başlık', () => {
    const withStatus = (status: string, extra: Record<string, unknown> = {}): void => {
      get.mockImplementation((path: string) => {
        if (path === 'appointments/a1')
          return Promise.resolve({ ...APPOINTMENT, status, ...extra });
        return Promise.resolve({ data: [] });
      });
    };

    it('başlıkta müşteri adı, telefon ve gün var', async () => {
      renderSheet(CATALOG, { customer: { id: 'c1', name: 'Ayşe Yılmaz', phone: '+905551112233' } });
      expect(await screen.findByRole('heading', { name: 'Ayşe Yılmaz' })).toBeInTheDocument();
      expect(screen.getByText('+905551112233')).toBeInTheDocument();
      expect(screen.getByText('10:00 – 10:30')).toBeInTheDocument();
    });

    it('BAŞKA müşterinin ipucu başlığa BASILMIYOR', async () => {
      renderSheet(CATALOG, { customer: { id: 'baska', name: 'Yanlış Kişi', phone: null } });
      await screen.findByText('Cilt bakımı');
      expect(screen.queryByText('Yanlış Kişi')).not.toBeInTheDocument();
    });

    it('şeritte GEÇİLEN adım düğme değil, GİDİLEBİLİR adım düğme; şimdiki adım işaretli', async () => {
      withStatus('confirmed');
      renderSheet();
      await screen.findByRole('button', { name: 'Geldi' });
      // Şimdiki adım tıklanamaz, `aria-current` taşır.
      expect(screen.queryByRole('button', { name: 'Onaylandı' })).not.toBeInTheDocument();
      expect(document.querySelector('[aria-current="step"]')).toHaveTextContent('Onaylandı');
      // Geri dönüş tablosunda yok: geçilen adım tıklanamaz.
      expect(screen.queryByRole('button', { name: 'Planlandı' })).not.toBeInTheDocument();
      // Kilitli ileri adım (işlemde `confirmed`dan doğrudan gidilemez).
      expect(screen.queryByRole('button', { name: 'İşlemde' })).not.toBeInTheDocument();
    });

    it('"Gelmedi" onay İSTİYOR; onaylanınca gidiyor', async () => {
      const user = userEvent.setup();
      withStatus('confirmed');
      renderSheet();

      await user.click(await screen.findByRole('button', { name: 'Gelmedi olarak işaretle' }));
      expect(post).not.toHaveBeenCalled();
      await user.click(await screen.findByRole('button', { name: 'Gelmedi' }));

      await waitFor(() => {
        expect(post).toHaveBeenCalledWith('appointments/a1/status', { status: 'no_show' });
      });
    });

    it('iptal edilmiş randevuda şerit YOK; sebep gösteriliyor, işlem düğmesi yok', async () => {
      withStatus('cancelled', { cancellationReason: 'Müşteri vazgeçti' });
      renderSheet();

      expect(await screen.findByText(/Müşteri vazgeçti/)).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Randevu ilerlemesi' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'İptal et' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ertele' })).not.toBeInTheDocument();
    });

    it('geçmiş satırları okunur: eylem adı ve durum geçişi', async () => {
      get.mockImplementation((path: string) => {
        if (path === 'appointments/a1') return Promise.resolve(APPOINTMENT);
        if (path === 'appointments/a1/history')
          return Promise.resolve({
            data: [
              {
                id: 'h1',
                action: 'status_changed',
                actorUserId: null,
                fromStatus: 'scheduled',
                toStatus: 'confirmed',
                oldStartsAt: null,
                newStartsAt: null,
                reason: null,
                createdAt: '2026-09-07T09:00:00+03:00',
              },
            ],
          });
        return Promise.resolve({ data: [] });
      });
      renderSheet();

      expect(await screen.findByText('Durum değişti')).toBeInTheDocument();
      expect(screen.getByText('Planlandı → Onaylandı')).toBeInTheDocument();
    });

    it('personel adı verilince hizmet satırında görünüyor', async () => {
      renderSheet(CATALOG, { staffNames: new Map([['p1', 'Dr. Deniz']]) });
      expect(await screen.findByText(/Dr\. Deniz/)).toBeInTheDocument();
    });
  });

  describe('onam (0053)', () => {
    const REQUIREMENTS = {
      appointmentId: 'a1',
      customerId: 'c1',
      customerName: 'Ayşe Yılmaz',
      items: [
        {
          kind: 'treatment',
          templateId: 'tpl1',
          title: 'Botoks onamı',
          satisfied: false,
          signatureId: null,
          document: null,
        },
      ],
      missingCount: 1,
    };

    beforeEach(() => {
      permissions = [
        PERMISSIONS.APPOINTMENT_WRITE,
        PERMISSIONS.CONSENT_READ,
        PERMISSIONS.CONSENT_COLLECT,
      ];
      get.mockImplementation((path: string) => {
        if (path === 'appointments/a1') return Promise.resolve({ ...APPOINTMENT, status: 'arrived' });
        if (path === 'appointments/a1/consent-requirements') return Promise.resolve(REQUIREMENTS);
        return Promise.resolve({ data: [] });
      });
    });

    it('eksik onam rozeti ve "Onam al" imza moduna götürüyor', async () => {
      const user = userEvent.setup();
      renderSheet();

      expect(await screen.findByText('1 onam eksik')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Onam al' }));
      expect(push).toHaveBeenCalledWith('/imza/randevu/a1?donus=%2Ftakvim');
    });

    // Sunucu eksik onamları gövdenin `missing` alanında döndürüyor.
    const CONSENT_MISSING = {
      code: 'CONSENT_MISSING',
      status: 409,
      missing: [{ kind: 'treatment', templateId: 'tpl1', title: 'Botoks onamı' }],
    };

    it('CONSENT_MISSING gerekçe diyaloğunu açıyor; gerekçe AYNI geçişle gidiyor', async () => {
      const user = userEvent.setup();
      post.mockImplementation((_path: string, body: Record<string, unknown>) =>
        body['consentOverrideReason'] === undefined
          ? Promise.reject(new ApiProblemError(CONSENT_MISSING, null))
          : Promise.resolve(undefined),
      );
      renderSheet();

      await user.click(await screen.findByRole('button', { name: 'İşlemde' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('Botoks onamı');

      const confirm = screen.getByRole('button', { name: 'Gerekçeyle devam et' });
      expect(confirm).toBeDisabled();
      await user.type(screen.getByLabelText('Gerekçe'), 'Kağıt form imzalandı');
      await user.click(confirm);

      await waitFor(() => {
        expect(post).toHaveBeenLastCalledWith('appointments/a1/status', {
          status: 'in_progress',
          consentOverrideReason: 'Kağıt form imzalandı',
        });
      });
    });
  });
});
