import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@klinara/shared';

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();

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

vi.mock('@/components/session/branch-provider', () => ({
  useBranch: () => ({ branchId: 'b1', loading: false, branches: [], canSelectAll: true }),
}));

let permissions: string[] = [];
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me: null, loading: false }),
}));

const { CatalogPage } = await import('../../src/components/catalog/catalog-page');
const { StaffPage } = await import('../../src/components/staff/staff-page');

const SERVICE = {
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
};

const SERVICE_2 = { ...SERVICE, id: 's2', slug: 'cilt', name: 'Cilt bakımı' };

const STAFF = {
  id: 'p1',
  tenantId: 't1',
  userId: 'u1',
  userFullName: 'Zeynep Kaya',
  userEmail: 'z@k.test',
  primaryBranchId: 'b1',
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
};

function mockRoutes(): void {
  get.mockImplementation((path: string) => {
    if (path === 'services') return Promise.resolve({ data: [SERVICE, SERVICE_2] });
    if (path === 'service-categories') {
      return Promise.resolve({
        data: [{ id: 'cat1', slug: 'epilasyon', name: 'Epilasyon', sortOrder: 0, isActive: true }],
      });
    }
    if (path === 'staff') return Promise.resolve({ data: [STAFF] });
    return Promise.resolve({ data: [] });
  });
}

describe('katalog', () => {
  beforeEach(() => {
    get.mockReset();
    del.mockReset();
    mockRoutes();
    permissions = [PERMISSIONS.SERVICE_READ, PERMISSIONS.SERVICE_WRITE];
  });

  it('hizmetleri fiyatıyla listeliyor', async () => {
    render(<CatalogPage />);
    expect(await screen.findByText('Lazer')).toBeInTheDocument();
    // İki hizmet de 500 TL; fiyatın BİÇİMLENDİĞİ iddia ediliyor, tekil
    // olduğu değil.
    expect(screen.getAllByText('₺500,00').length).toBeGreaterThan(0);
  });

  it('SALT OKUNUR rolde ekran görünür, düğmeler YOK', async () => {
    // Menüden çıkarmak yanlış olurdu: resepsiyon "bu hizmet kaç dakika"
    // sorusunu sormak zorunda ve cevabı burada.
    permissions = [PERMISSIONS.SERVICE_READ];
    render(<CatalogPage />);

    expect(await screen.findByText('Lazer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yeni hizmet' })).not.toBeInTheDocument();
    expect(screen.getByText(/değişiklik için yetkiniz yok/i)).toBeInTheDocument();
  });

  it('hizmet SİLİNMİYOR, PASİFE alınıyor', async () => {
    // Geçmiş randevular bu hizmete bağlı ve silinemez; arayüz de "sil"
    // demiyor.
    render(<CatalogPage />);
    await screen.findByText('Lazer');

    expect(screen.queryByRole('button', { name: 'Sil' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Pasife al' }).length).toBeGreaterThan(0);
  });
  it('arama ve kategori süzgeci listeyi daraltıyor', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path === 'services') {
        return Promise.resolve({
          data: [SERVICE, { ...SERVICE_2, categoryId: 'cat2', isActive: false }],
        });
      }
      if (path === 'service-categories') {
        return Promise.resolve({
          data: [
            { id: 'cat1', slug: 'epilasyon', name: 'Epilasyon', sortOrder: 0, isActive: true },
            { id: 'cat2', slug: 'cilt', name: 'Cilt', sortOrder: 1, isActive: true },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    render(<CatalogPage />);
    await screen.findByText('Lazer');

    await user.selectOptions(screen.getByLabelText('Kategori'), 'cat2');
    expect(screen.queryByText('Lazer')).not.toBeInTheDocument();
    expect(screen.getByText('Cilt bakımı')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Durum'), 'active');
    expect(screen.getByText('Süzgeçlere uyan kayıt yok.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Kategori'), '');
    await user.type(screen.getByLabelText('Ara (hizmet adı)'), 'LAZ');
    expect(screen.getByText('Lazer')).toBeInTheDocument();
  });
});

describe('personel', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    mockRoutes();
    put.mockResolvedValue({});
    permissions = [PERMISSIONS.STAFF_READ, PERMISSIONS.STAFF_WRITE];
  });

  it('ROL DEĞİŞTİRİLEMEZ ve sebebi yazılı', async () => {
    // API'de üyelik/rol değiştiren bir uç YOK; sahte bir rol seçici koymak
    // olmayan bir yetenek vaat etmek olurdu.
    render(<StaffPage />);
    expect(await screen.findByText(/pasife alıp yeniden davet edin/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Rol')).not.toBeInTheDocument();
  });

  it('yetkinlik matrisi MEVCUT seçimle açılıyor', async () => {
    const user = userEvent.setup();
    render(<StaffPage />);

    await user.click(await screen.findByRole('button', { name: 'Hizmet yetkinlikleri' }));

    expect(await screen.findByRole('checkbox', { name: 'Lazer' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Cilt bakımı' })).not.toBeChecked();
  });

  it('kaydetme TAM LİSTEYİ gönderiyor', async () => {
    // ⚠️ `PUT /staff/:id/services` TAM DEĞİŞTİRME: işareti kaldırılan
    // hizmet personelden SİLİNİR.
    const user = userEvent.setup();
    render(<StaffPage />);

    await user.click(await screen.findByRole('button', { name: 'Hizmet yetkinlikleri' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Cilt bakımı' }));
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('staff/p1/services', {
        services: [{ serviceId: 's1' }, { serviceId: 's2' }],
      });
    });
  });

  it('işaret KALDIRILINCA hizmet listeden çıkıyor', async () => {
    const user = userEvent.setup();
    render(<StaffPage />);

    await user.click(await screen.findByRole('button', { name: 'Hizmet yetkinlikleri' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Lazer' }));
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('staff/p1/services', { services: [] });
    });
  });

  it('arama e-postada da eşleşiyor', async () => {
    const user = userEvent.setup();
    render(<StaffPage />);
    await screen.findByText('Zeynep Kaya');

    await user.type(screen.getByLabelText('Ara (ad veya e-posta)'), 'yok@');
    expect(screen.queryByText('Zeynep Kaya')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Ara (ad veya e-posta)'));
    await user.type(screen.getByLabelText('Ara (ad veya e-posta)'), 'z@k');
    expect(screen.getByText('Zeynep Kaya')).toBeInTheDocument();
  });

  it('yazma izni YOKKEN matris açılamıyor', async () => {
    permissions = [PERMISSIONS.STAFF_READ];
    render(<StaffPage />);

    await screen.findByText('Zeynep Kaya');
    expect(screen.queryByRole('button', { name: 'Hizmet yetkinlikleri' })).not.toBeInTheDocument();
  });
});
