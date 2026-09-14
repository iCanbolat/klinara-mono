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
    readonly problem: { code: string; status: number } & Record<string, unknown>,
    readonly retryAfterSeconds: number | null,
  ) {
    super(problem.code);
  }
  get code(): string {
    return this.problem.code;
  }
}

vi.mock('@/lib/api/client', () => ({ api: { get, post, patch }, ApiProblemError, SessionExpiredError }));

let permissions: string[] = [PERMISSIONS.CUSTOMER_READ, PERMISSIONS.CUSTOMER_WRITE];
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me: null, loading: false }),
}));

const { CustomersPage } = await import('../../src/components/customers/customers-page');
const { NotesPanel } = await import('../../src/components/customers/notes-panel');

const customer = (id: string, name: string) => ({
  id,
  tenantId: 't1',
  fullName: name,
  phone: `+9053200000${id.slice(-2)}`,
  email: null,
  birthDate: null,
  gender: null,
  notes: null,
  addressLine: null,
  district: null,
  city: null,
  postalCode: null,
  source: null,
  mergedIntoCustomerId: null,
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
});

describe('müşteri defteri', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    permissions = [PERMISSIONS.CUSTOMER_READ, PERMISSIONS.CUSTOMER_WRITE];
  });

  it('cursor ile ilk sayfayı yüklüyor', async () => {
    get.mockImplementation((path: string) => {
      if (path.startsWith('customers?')) {
        return Promise.resolve({
          data: [customer('c01', 'Ayşe Yılmaz')],
          pageInfo: { nextCursor: 'CUR1', hasMore: true },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<CustomersPage />);
    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();
  });

  it('"Sonraki" sayfayı DEĞİŞTİRİYOR, "Önceki" cursor yığınıyla geri getiriyor', async () => {
    // Cursor sayfalamada toplam yok; Önceki / Sonraki var. API geriye doğru
    // cursor vermediği için "Önceki" bir önceki cursor'ı YENİDEN istiyor.
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path.startsWith('customers?')) {
        return path.includes('cursor=CUR1')
          ? Promise.resolve({
              data: [customer('c02', 'Mehmet Demir')],
              pageInfo: { nextCursor: null, hasMore: false },
            })
          : Promise.resolve({
              data: [customer('c01', 'Ayşe Yılmaz')],
              pageInfo: { nextCursor: 'CUR1', hasMore: true },
            });
      }
      return Promise.resolve({ data: [] });
    });

    render(<CustomersPage />);
    await screen.findByText('Ayşe Yılmaz');
    expect(screen.getByRole('button', { name: 'Önceki' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Sonraki' }));

    expect(await screen.findByText('Mehmet Demir')).toBeInTheDocument();
    // Sayfa DEĞİŞTİ, eklenmedi.
    expect(screen.queryByText('Ayşe Yılmaz')).not.toBeInTheDocument();
    expect(screen.getByText('Sayfa 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sonraki' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Önceki' }));

    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.queryByText('Mehmet Demir')).not.toBeInTheDocument();
    // İlk sayfa cursor'SUZ yeniden istendi.
    const listCalls = get.mock.calls.map((c) => String(c[0])).filter((c) => c.startsWith('customers?'));
    expect(listCalls.at(-1)).not.toContain('cursor=');
  });

  it('ARAMA en az 2 karakterden önce ÇAĞRILMIYOR', async () => {
    // Sunucu `q` için 2 karakter istiyor; altında çağırmak garantili 400 ve
    // kullanıcı her harfte kırmızı bir satır görürdü.
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path.startsWith('customers?')) {
        return Promise.resolve({ data: [], pageInfo: { nextCursor: null, hasMore: false } });
      }
      return Promise.resolve([]);
    });

    render(<CustomersPage />);
    await user.type(screen.getByLabelText('Ara (ad veya telefon)'), 'a');

    await waitFor(() => {
      expect(get.mock.calls.some((c) => String(c[0]).startsWith('customers/search'))).toBe(false);
    });
  });

  it('arama ÇIPLAK DİZİ yanıtını doğru okuyor', async () => {
    // ⚠️ `GET /customers/search` `{ data }` zarfı TAŞIMIYOR. `.data`
    // beklemek çalışma zamanında `undefined.map` olarak patlar.
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path.startsWith('customers/search')) {
        return Promise.resolve([customer('c09', 'Zeynep Kaya')]);
      }
      return Promise.resolve({ data: [], pageInfo: { nextCursor: null, hasMore: false } });
    });

    render(<CustomersPage />);
    await user.type(screen.getByLabelText('Ara (ad veya telefon)'), 'zeynep');

    expect(await screen.findByText('Zeynep Kaya')).toBeInTheDocument();
    // Arama sayfalanmıyor: "daha fazla" gösterilmiyor.
    expect(screen.queryByRole('button', { name: 'Sonraki' })).not.toBeInTheDocument();
  });

  it('`customer:write` YOKKEN yeni müşteri düğmesi yok', async () => {
    permissions = [PERMISSIONS.CUSTOMER_READ];
    get.mockResolvedValue({ data: [], pageInfo: { nextCursor: null, hasMore: false } });

    render(<CustomersPage />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Yeni müşteri' })).not.toBeInTheDocument();
    });
  });
});

describe('not paneli — tıbbi sessizliğin telafisi', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({ data: [] });
  });

  it('tıbbi izin YOKKEN tedavi sekmesi YOK ve sebep YAZILI', async () => {
    // ⚠️ EN KRİTİK İDDİA.
    // Sunucu `treatment`/`internal` notları SESSİZCE eliyor. Boş bir
    // "Tedavi" seçeneği göstermek, resepsiyona "bu müşterinin tedavi notu
    // yok" der — kliniğin en hassas verisi hakkında YANLIŞ BİLGİ.
    permissions = [PERMISSIONS.CUSTOMER_READ, PERMISSIONS.CUSTOMER_WRITE];
    render(<NotesPanel customerId="c1" />);

    expect(await screen.findByText(/yetkiniz dâhilinde değil/i)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Tedavi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'İç not' })).not.toBeInTheDocument();
  });

  it('tıbbi izin VARKEN açıklama YOK ve türler seçilebiliyor', async () => {
    permissions = [
      PERMISSIONS.CUSTOMER_READ,
      PERMISSIONS.CUSTOMER_WRITE,
      PERMISSIONS.CUSTOMER_MEDICAL_READ,
      PERMISSIONS.CUSTOMER_MEDICAL_WRITE,
    ];
    render(<NotesPanel customerId="c1" />);

    expect(await screen.findByRole('option', { name: 'Tedavi' })).toBeInTheDocument();
    expect(screen.queryByText(/yetkiniz dâhilinde değil/i)).not.toBeInTheDocument();
  });

  it('tıbbi notu GÖRÜP yazamayan kullanıcı tür seçeneğini görmüyor', async () => {
    // `manager` tıbbi notu görür ama yazamaz; yazma formu yalnız
    // yazabildiği türleri sunmalı.
    permissions = [
      PERMISSIONS.CUSTOMER_READ,
      PERMISSIONS.CUSTOMER_WRITE,
      PERMISSIONS.CUSTOMER_MEDICAL_READ,
    ];
    render(<NotesPanel customerId="c1" />);

    await screen.findByRole('option', { name: 'Genel' });
    expect(screen.queryByRole('option', { name: 'Tedavi' })).not.toBeInTheDocument();
    // Ama açıklama satırı da YOK: notları görebiliyor.
    expect(screen.queryByText(/yetkiniz dâhilinde değil/i)).not.toBeInTheDocument();
  });

  it('SÜRÜM değiştiyse uyarı basılıyor ama kayıt engellenmiyor', async () => {
    // `PATCH /notes/:id` `If-Match` istemiyor: son yazan kazanır. Kilit
    // koyamıyoruz ama sessiz kalmıyoruz.
    permissions = [PERMISSIONS.CUSTOMER_READ, PERMISSIONS.CUSTOMER_WRITE];
    let call = 0;
    get.mockImplementation(() => {
      call += 1;
      return Promise.resolve({
        data: [
          {
            id: 'n1',
            customerId: 'c1',
            appointmentId: null,
            kind: 'general',
            body: 'ilk',
            customerVisible: false,
            authorUserId: null,
            version: call === 1 ? 1 : 4,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
    });

    const user = userEvent.setup();
    const { rerender } = render(<NotesPanel customerId="c1" />);
    await screen.findByText('ilk');
    expect(screen.queryByText(/biri değiştirdi/i)).not.toBeInTheDocument();

    // Not ekleyerek yeniden yüklemeyi tetikle; sürüm 1 → 4.
    await user.type(screen.getByLabelText('Not'), 'x');
    await user.click(screen.getByRole('button', { name: 'Not ekle' }));
    rerender(<NotesPanel customerId="c1" />);

    expect(await screen.findByText(/biri değiştirdi/i)).toBeInTheDocument();
  });
});
