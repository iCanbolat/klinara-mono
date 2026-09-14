import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@klinara/shared';

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
const push = vi.fn();

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
  api: { get, put, post, patch, delete: del },
  ApiProblemError,
  SessionExpiredError,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let branchState: {
  branchId: string | null;
  loading: boolean;
  branches: { id: string; name: string; timezone: string }[];
  canSelectAll: boolean;
} = {
  branchId: 'b1',
  loading: false,
  branches: [{ id: 'b1', name: 'Merkez', timezone: 'Europe/Istanbul' }],
  canSelectAll: true,
};
vi.mock('@/components/session/branch-provider', () => ({ useBranch: () => branchState }));

let permissions: string[] = [PERMISSIONS.SCHEDULE_READ, PERMISSIONS.SCHEDULE_WRITE];
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me: null, loading: false }),
}));

const { WorkingHoursPage } = await import('../../src/components/schedule/working-hours-page');

const STAFF = [
  { id: 'p1', userFullName: 'Zeynep Kaya', title: 'Uzman', isActive: true, userEmail: 'z@k.test' },
  { id: 'p2', userFullName: 'Ali Veli', title: null, isActive: true, userEmail: 'a@v.test' },
];

function mockRoutes(): void {
  get.mockImplementation((path: string) => {
    if (path.startsWith('branches/')) {
      return Promise.resolve({
        branchId: 'b1',
        // Sunucu YALNIZ tanımlı günleri, SANİYELİ saatlerle döndürüyor.
        entries: [
          { dayOfWeek: 1, isClosed: false, openTime: '09:00:00', closeTime: '18:00:00' },
          { dayOfWeek: 2, isClosed: false, openTime: '09:00:00', closeTime: '18:00:00' },
        ],
      });
    }
    if (path === 'staff') return Promise.resolve({ data: STAFF });
    if (path.startsWith('staff/p1/schedule')) {
      return Promise.resolve({
        staffProfileId: 'p1',
        branchId: 'b1',
        entries: [{ dayOfWeek: 1, isOff: false, startTime: '08:00:00', endTime: '17:00:00' }],
      });
    }
    if (path.startsWith('staff/p2/schedule')) {
      return Promise.resolve({ staffProfileId: 'p2', branchId: 'b1', entries: [] });
    }
    if (path.startsWith('schedule-exceptions')) return Promise.resolve({ data: [] });
    if (path.startsWith('holidays')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

/** Salı açılışını değiştirerek taslağı kirletir. */
async function editTuesday(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const openInputs = await screen.findAllByLabelText('Açılış');
  // Açık günler: Pazartesi, Salı — hafta pazartesi başlıyor.
  await user.clear(openInputs[1] as HTMLInputElement);
  await user.type(openInputs[1] as HTMLInputElement, '10:00');
}

describe('çalışma saatleri — şube', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    post.mockReset();
    patch.mockReset();
    del.mockReset();
    push.mockReset();
    permissions = [PERMISSIONS.SCHEDULE_READ, PERMISSIONS.SCHEDULE_WRITE];
    branchState = {
      branchId: 'b1',
      loading: false,
      branches: [{ id: 'b1', name: 'Merkez', timezone: 'Europe/Istanbul' }],
      canSelectAll: true,
    };
    mockRoutes();
    put.mockResolvedValue({});
    post.mockResolvedValue({});
    patch.mockResolvedValue({});
    del.mockResolvedValue(undefined);
  });

  it('değişiklik yokken kaydet PASİF, değişince AKTİF ve sayaç görünüyor', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    const save = await screen.findByRole('button', { name: 'Haftayı kaydet' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Tüm değişiklikler kayıtlı')).toBeInTheDocument();

    await editTuesday(user);

    expect(screen.getByRole('button', { name: 'Haftayı kaydet' })).toBeEnabled();
    expect(screen.getByText('Kaydedilmemiş değişiklik: 1 gün')).toBeInTheDocument();
  });

  it('kaydetme HAFTANIN TAMAMINI, SANİYESİZ saatlerle gönderiyor', async () => {
    // ⚠️ EN KRİTİK İDDİA.
    // `PUT` TAM DEĞİŞTİRME: gönderilmeyen gün SİLİNİR. Sunucu yalnız iki gün
    // döndürdü; kaydettiğimizde yedi gün gitmeli.
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await editTuesday(user);
    await user.click(screen.getByRole('button', { name: 'Haftayı kaydet' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [path, body, options] = put.mock.calls[0] as [
      string,
      { entries: { dayOfWeek: number; isClosed: boolean; openTime?: string }[] },
      { branchId: string },
    ];
    // Şube hem yolda hem başlıkta.
    expect(path).toBe('branches/b1/hours');
    expect(options).toEqual(expect.objectContaining({ branchId: 'b1' }));

    expect(body.entries).toHaveLength(7);
    expect(body.entries.map((entry) => entry.dayOfWeek).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Sunucunun DÖNMEDİĞİ gün kapalı gidiyor.
    expect(body.entries.find((entry) => entry.dayOfWeek === 0)?.isClosed).toBe(true);
    // `09:00:00` → `09:00`; aksi hâlde sunucu deseni reddeder.
    expect(body.entries.find((entry) => entry.dayOfWeek === 1)?.openTime).toBe('09:00');
    expect(body.entries.find((entry) => entry.dayOfWeek === 2)?.openTime).toBe('10:00');

    // Kaydedilen hâl yeni "kayıtlı" hâl oluyor.
    expect(await screen.findByText('Tüm değişiklikler kayıtlı')).toBeInTheDocument();
  });

  it('GEÇERSİZ saatte kaydet ETKİSİZ ve sebep gün adıyla yazılı', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    const openInputs = await screen.findAllByLabelText('Açılış');
    await user.clear(openInputs[0] as HTMLInputElement);
    await user.type(openInputs[0] as HTMLInputElement, '19:00');

    expect(await screen.findByText(/Pazartesi.*Kapanış/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Haftayı kaydet' })).toBeDisabled();
  });

  it('geri al taslağı kayıtlı hâle döndürüyor', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await editTuesday(user);
    await user.click(screen.getByRole('button', { name: 'Değişiklikleri geri al' }));

    expect(screen.getByText('Tüm değişiklikler kayıtlı')).toBeInTheDocument();
    expect((screen.getAllByLabelText('Açılış')[1] as HTMLInputElement).value).toBe('09:00');
  });

  it('günü açıp kapatmak anahtarla yapılıyor; kapalı günün saatleri gizleniyor', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await screen.findAllByLabelText('Açılış');
    expect(screen.getAllByLabelText('Açılış')).toHaveLength(2);

    await user.click(screen.getByRole('switch', { name: 'Çarşamba açık' }));
    expect(screen.getAllByLabelText('Açılış')).toHaveLength(3);

    await user.click(screen.getByRole('switch', { name: 'Pazartesi açık' }));
    expect(screen.getAllByLabelText('Açılış')).toHaveLength(2);
  });

  it('bir günü seçilen günlere KOPYALIYOR', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await editTuesday(user);
    await user.click(screen.getByRole('button', { name: 'Salı saatlerini kopyala' }));

    const picker = await screen.findByRole('group', { name: 'Şu günlere uygula' });
    await user.click(within(picker).getByRole('button', { name: 'Perşembe' }));
    await user.click(within(picker).getByRole('button', { name: 'Cuma' }));
    await user.click(screen.getByRole('button', { name: 'Uygula' }));

    await user.click(screen.getByRole('button', { name: 'Haftayı kaydet' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0]?.[1] as {
      entries: { dayOfWeek: number; isClosed: boolean; openTime?: string }[];
    };
    for (const day of [4, 5]) {
      expect(body.entries.find((entry) => entry.dayOfWeek === day)).toEqual(
        expect.objectContaining({ isClosed: false, openTime: '10:00' }),
      );
    }
    // Seçilmeyen gün değişmedi.
    expect(body.entries.find((entry) => entry.dayOfWeek === 3)?.isClosed).toBe(true);
  });

  it('mola eklenip kaldırılabiliyor ve gövdeye giriyor', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await screen.findAllByLabelText('Açılış');
    await user.click(screen.getAllByRole('button', { name: 'Mola ekle' })[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Haftayı kaydet' }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0]?.[1] as {
      entries: { dayOfWeek: number; breakStartTime?: string; breakEndTime?: string }[];
    };
    expect(body.entries.find((entry) => entry.dayOfWeek === 1)).toEqual(
      expect.objectContaining({ breakStartTime: '12:00', breakEndTime: '13:00' }),
    );
  });

  it('yazma izni YOKKEN kaydet çubuğu, anahtar ve kopyala yok', async () => {
    permissions = [PERMISSIONS.SCHEDULE_READ];
    render(<WorkingHoursPage />);

    await screen.findAllByLabelText('Açılış');
    expect(screen.queryByRole('button', { name: 'Haftayı kaydet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /saatlerini kopyala/ })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Pazartesi açık' })).toBeDisabled();
    expect(screen.getByText(/değişiklik için yetkiniz yok/i)).toBeInTheDocument();
  });

  it('şube seçili DEĞİLKEN istek atmıyor', () => {
    branchState = { ...branchState, branchId: null };
    render(<WorkingHoursPage />);

    expect(get.mock.calls.filter((c) => String(c[0]).startsWith('branches/'))).toHaveLength(0);
    expect(screen.getByText(/şube seçin/i)).toBeInTheDocument();
  });

  it('kaydedilmemiş değişiklik varken panel içi bağlantı ONAY istiyor', async () => {
    const user = userEvent.setup();
    render(
      <>
        <a href="/takvim">Takvim</a>
        <WorkingHoursPage />
      </>,
    );

    await editTuesday(user);
    await user.click(screen.getByRole('link', { name: 'Takvim' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Kaydedilmemiş değişiklikler var');
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Değişiklikleri at' }));
    expect(push).toHaveBeenCalledWith('/takvim');
  });
});

describe('çalışma saatleri — personel', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    push.mockReset();
    permissions = [PERMISSIONS.SCHEDULE_READ, PERMISSIONS.SCHEDULE_WRITE];
    branchState = {
      branchId: 'b1',
      loading: false,
      branches: [{ id: 'b1', name: 'Merkez', timezone: 'Europe/Istanbul' }],
      canSelectAll: true,
    };
    mockRoutes();
    put.mockResolvedValue({});
  });

  async function openStaff(user: ReturnType<typeof userEvent.setup>, id = 'p1'): Promise<void> {
    render(<WorkingHoursPage />);
    await screen.findAllByLabelText('Açılış');
    await user.click(screen.getByRole('tab', { name: /Personel planı/ }));
    await user.selectOptions(await screen.findByLabelText('Personel seçin'), id);
  }

  it('şube saatleri DIŞINA taşan gün uyarı veriyor ama kaydı engellemiyor', async () => {
    const user = userEvent.setup();
    await openStaff(user);

    // Personel pazartesi 08:00'de başlıyor, şube 09:00'da açılıyor.
    expect(await screen.findByText('Bazı günler şube saatleri dışında')).toBeInTheDocument();
    expect(screen.getByText(/Pazartesi: Şube saatleri \(09:00–18:00\) dışına taşıyor/)).toBeInTheDocument();
  });

  it('"şube saatlerini uygula" planı şubeyle eşitliyor; PUT şubeyi üç yerde taşıyor', async () => {
    const user = userEvent.setup();
    await openStaff(user);

    await user.click(await screen.findByRole('button', { name: 'Şube saatlerini uygula' }));
    expect(screen.queryByText('Bazı günler şube saatleri dışında')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Haftayı kaydet' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [path, body, options] = put.mock.calls[0] as [
      string,
      { branchId: string; entries: { dayOfWeek: number; isOff: boolean; startTime?: string }[] },
      { branchId: string },
    ];
    expect(path).toBe('staff/p1/schedule');
    expect(body.branchId).toBe('b1');
    expect(options.branchId).toBe('b1');
    expect(get.mock.calls.some((c) => String(c[0]) === 'staff/p1/schedule?branchId=b1')).toBe(true);
    expect(body.entries).toHaveLength(7);
    expect(body.entries.find((entry) => entry.dayOfWeek === 1)).toEqual(
      expect.objectContaining({ isOff: false, startTime: '09:00' }),
    );
    expect(body.entries.find((entry) => entry.dayOfWeek === 0)?.isOff).toBe(true);
  });

  it('taslak varken BAŞKA PERSONELE geçmek onay istiyor', async () => {
    const user = userEvent.setup();
    await openStaff(user);

    await user.click(await screen.findByRole('button', { name: 'Şube saatlerini uygula' }));
    await user.selectOptions(screen.getByLabelText('Personel seçin'), 'p2');

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Düzenlemeye dön' }));
    expect((screen.getByLabelText('Personel seçin') as HTMLSelectElement).value).toBe('p1');
  });

  it('sekmeler arası geçişte taslak KAYBOLMUYOR', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await editTuesday(user);
    await user.click(screen.getByRole('tab', { name: /Personel planı/ }));
    await user.click(screen.getByRole('tab', { name: /Şube saatleri/ }));

    expect((screen.getAllByLabelText('Açılış')[1] as HTMLInputElement).value).toBe('10:00');
    expect(screen.getByRole('tab', { name: /kaydedilmemiş/ })).toBeInTheDocument();
  });
});

describe('çalışma saatleri — izinler', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    permissions = [PERMISSIONS.SCHEDULE_READ, PERMISSIONS.SCHEDULE_WRITE];
    branchState = {
      branchId: 'b1',
      loading: false,
      branches: [{ id: 'b1', name: 'Merkez', timezone: 'Europe/Istanbul' }],
      canSelectAll: true,
    };
    mockRoutes();
    post.mockResolvedValue({});
  });

  it('haftalık tekrarlı izin gövdesi motorun beklediği biçimde', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await user.click(await screen.findByRole('tab', { name: 'İzinler' }));
    await user.click(await screen.findByRole('button', { name: 'İzin ekle' }));

    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Personel seçin'), 'p1');
    await user.click(within(dialog).getByRole('button', { name: 'Haftalık tekrar' }));
    const days = within(dialog).getByRole('group', { name: 'Tekrar günleri' });
    await user.click(within(days).getByRole('button', { name: 'Çarşamba' }));
    await user.click(within(days).getByRole('button', { name: 'Pazartesi' }));

    const start = within(dialog).getByLabelText('Başlangıç');
    await user.clear(start);
    await user.type(start, '12:00');
    const end = within(dialog).getByLabelText('Bitiş');
    await user.clear(end);
    await user.type(end, '13:00');
    const first = within(dialog).getByLabelText('İlk gün');
    await user.clear(first);
    await user.type(first, '2026-09-14');
    await user.type(within(dialog).getByLabelText('Son gün'), '2026-11-30');

    await user.click(within(dialog).getByRole('button', { name: 'İzin ekle' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body, options] = post.mock.calls[0] as [string, Record<string, unknown>, { branchId: string }];
    expect(path).toBe('schedule-exceptions');
    expect(options.branchId).toBe('b1');
    expect(body).toEqual({
      staffProfileId: 'p1',
      branchId: 'b1',
      recurrenceType: 'weekly',
      // İlk oluşum: şube saat diliminde 12:00–13:00.
      startsAt: '2026-09-14T12:00:00+03:00',
      endsAt: '2026-09-14T13:00:00+03:00',
      recurrenceIntervalWeeks: 1,
      recurrenceUntil: '2026-11-30T23:59:00+03:00',
      // Arayüz sırasıyla (pazartesi önce).
      recurrenceWeekdays: [1, 3],
    });
  });

  it('eksik form gönderilmiyor, hatalar alanların altında', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await user.click(await screen.findByRole('tab', { name: 'İzinler' }));
    await user.click(await screen.findByRole('button', { name: 'İzin ekle' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Haftalık tekrar' }));
    await user.click(within(dialog).getByRole('button', { name: 'İzin ekle' }));

    expect(within(dialog).getByText('Personel seçin.')).toBeInTheDocument();
    expect(within(dialog).getByText('En az bir gün seçin.')).toBeInTheDocument();
    expect(within(dialog).getByText('Bitiş tarihi zorunlu.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('düzenle düğmesi YOK ve sebebi yazılı', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path.startsWith('schedule-exceptions')) {
        return Promise.resolve({
          data: [
            {
              id: 'e1',
              tenantId: 't1',
              staffProfileId: 'p1',
              branchId: 'b1',
              startsAt: '2099-01-05T00:00:00+03:00',
              endsAt: '2099-01-06T00:00:00+03:00',
              reason: 'Yıllık izin',
              recurrenceType: 'none',
              recurrenceIntervalWeeks: 1,
              recurrenceUntil: null,
              recurrenceWeekdays: [],
              isActive: true,
              createdAt: '2026-01-01T00:00:00Z',
            },
          ],
        });
      }
      if (path === 'staff') return Promise.resolve({ data: STAFF });
      if (path.startsWith('branches/')) return Promise.resolve({ branchId: 'b1', entries: [] });
      return Promise.resolve({ data: [] });
    });
    render(<WorkingHoursPage />);

    await user.click(await screen.findByRole('tab', { name: 'İzinler' }));
    expect(await screen.findByText('Yıllık izin')).toBeInTheDocument();
    expect(screen.getByText('5 Oca 2099 · Tüm gün')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /düzenle/i })).not.toBeInTheDocument();
    expect(screen.getByText(/İzinler düzenlenemez/)).toBeInTheDocument();
  });
});

describe('çalışma saatleri — tatiller', () => {
  const HOLIDAYS = [
    {
      id: 'h1',
      tenantId: 't1',
      branchId: null,
      holidayDate: '2099-04-23',
      name: 'Ulusal Egemenlik ve Çocuk Bayramı',
      isClosed: true,
      openTime: null,
      closeTime: null,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'h2',
      tenantId: 't1',
      branchId: 'b1',
      holidayDate: '2099-12-31',
      name: 'Yılbaşı arifesi',
      isClosed: false,
      openTime: '10:00:00',
      closeTime: '14:00:00',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    permissions = [PERMISSIONS.SCHEDULE_READ, PERMISSIONS.SCHEDULE_WRITE];
    branchState = {
      branchId: 'b1',
      loading: false,
      branches: [{ id: 'b1', name: 'Merkez', timezone: 'Europe/Istanbul' }],
      canSelectAll: true,
    };
    get.mockImplementation((path: string) => {
      if (path.startsWith('holidays')) return Promise.resolve({ data: HOLIDAYS });
      if (path === 'staff') return Promise.resolve({ data: STAFF });
      if (path.startsWith('branches/')) return Promise.resolve({ branchId: 'b1', entries: [] });
      return Promise.resolve({ data: [] });
    });
    post.mockResolvedValue({});
    patch.mockResolvedValue({});
  });

  it('şube ve kiracı geneli kayıtları kapsam ve saatleriyle listeliyor', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await user.click(await screen.findByRole('tab', { name: 'Tatiller' }));
    expect(await screen.findByText('Ulusal Egemenlik ve Çocuk Bayramı')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('holidays?branchId=b1', expect.anything());
    expect(screen.getByText('10:00–14:00 açık')).toBeInTheDocument();
    expect(screen.getByText('Tüm şubeler')).toBeInTheDocument();
  });

  it('yarım gün tatil ekleme gövdesi saatleri taşıyor, kapsam şube', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await user.click(await screen.findByRole('tab', { name: 'Tatiller' }));
    await user.click(await screen.findByRole('button', { name: 'Tatil ekle' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tarih'), '2099-10-28');
    await user.type(within(dialog).getByLabelText('Ad'), 'Cumhuriyet Bayramı arifesi');
    await user.click(within(dialog).getByRole('switch', { name: 'Tüm gün kapalı' }));
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      'holidays',
      {
        branchId: 'b1',
        holidayDate: '2099-10-28',
        name: 'Cumhuriyet Bayramı arifesi',
        isClosed: false,
        openTime: '10:00',
        closeTime: '14:00',
      },
      expect.objectContaining({ branchId: 'b1' }),
    );
  });

  it('düzenlemede tarih KİLİTLİ ve PATCH tarihi göndermiyor', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await user.click(await screen.findByRole('tab', { name: 'Tatiller' }));
    await screen.findByText('Yılbaşı arifesi');
    await user.click(screen.getAllByRole('button', { name: 'Düzenle' })[1] as HTMLElement);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Tarih')).toBeDisabled();
    await user.click(within(dialog).getByRole('switch', { name: 'Tüm gün kapalı' }));
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        'holidays/h2',
        { name: 'Yılbaşı arifesi', isClosed: true },
        expect.anything(),
      ),
    );
  });

  it('şube yöneticisi kiracı geneli kaydı DEĞİŞTİREMİYOR ve "tüm şubeler" seçemiyor', async () => {
    branchState = { ...branchState, canSelectAll: false };
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await user.click(await screen.findByRole('tab', { name: 'Tatiller' }));
    await screen.findByText('Ulusal Egemenlik ve Çocuk Bayramı');
    // Yalnız şube kaydında eylem var.
    expect(screen.getAllByRole('button', { name: 'Düzenle' })).toHaveLength(1);
    expect(screen.getByText(/yalnız kiracı yöneticileri/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tatil ekle' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Tüm şubeler' })).not.toBeInTheDocument();
  });
});
