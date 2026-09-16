import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  useBranch: () => ({
    branchId: 'b1',
    loading: false,
    branches: [
      { id: 'b1', name: 'Nişantaşı', timezone: 'Europe/Istanbul', isActive: true },
      { id: 'b2', name: 'Bodrum', timezone: 'Europe/Istanbul', isActive: true },
    ],
    canSelectAll: true,
    setBranchId: vi.fn(),
    reload: vi.fn(),
  }),
}));

let permissions: string[] = [];
let me: unknown = null;
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me, loading: false }),
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
};

const PRACTITIONER_B1 = { id: 'm1', branchId: 'b1', roleKey: 'practitioner', roleName: 'Uygulayıcı' };
let memberships: unknown[] = [PRACTITIONER_B1];

function mockRoutes(): void {
  get.mockImplementation((path: string) => {
    if (path === 'services') return Promise.resolve({ data: [SERVICE, SERVICE_2] });
    if (path === 'service-categories') {
      return Promise.resolve({
        data: [{ id: 'cat1', slug: 'epilasyon', name: 'Epilasyon', sortOrder: 0, isActive: true }],
      });
    }
    if (path === 'staff' || path === 'staff?branchId=b1') return Promise.resolve({ data: [STAFF] });
    if (path === 'staff?branchId=b2') return Promise.resolve({ data: [] });
    if (path === 'users') {
      return Promise.resolve({ data: [{ id: 'u1', memberships: memberships }] });
    }
    if (path === 'users/u1/memberships') return Promise.resolve({ data: memberships });
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
    me = null;
    memberships = [PRACTITIONER_B1];
  });

  it('liste SEÇİLİ ŞUBEYLE isteniyor; "Tüm şubeler" süzgeçsiz istiyor', async () => {
    const user = userEvent.setup();
    render(<StaffPage />);
    await screen.findByText('Zeynep Kaya');
    expect(get).toHaveBeenCalledWith('staff?branchId=b1', expect.anything());

    await user.selectOptions(screen.getByLabelText('Şube'), 'b2');
    expect(await screen.findByText('Personel yok.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Şube'), '');
    expect(await screen.findByText('Zeynep Kaya')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('staff', expect.anything());
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

describe('personel — roller ve şubeler', () => {
  const OWNER = {
    user: { id: 'owner-1' },
    roles: ['owner'],
    permissions: [],
    branchIds: [],
    tenantWide: true,
  };
  const MANAGER_B1 = {
    user: { id: 'manager-1' },
    roles: ['manager'],
    permissions: [],
    branchIds: ['b1'],
    tenantWide: false,
  };

  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    mockRoutes();
    permissions = [
      PERMISSIONS.STAFF_READ,
      PERMISSIONS.STAFF_WRITE,
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_WRITE,
    ];
    memberships = [PRACTITIONER_B1];
    me = OWNER;
  });

  async function openEditor(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    render(<StaffPage />);
    await user.click(await screen.findByRole('button', { name: 'Düzenle' }));
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByText('Roller ve şubeler');
    return sheet;
  }

  it('rol kolonu şube adıyla görünüyor', async () => {
    render(<StaffPage />);
    expect(await screen.findByText('Uygulayıcı')).toBeInTheDocument();
    expect(screen.getByText('· Nişantaşı')).toBeInTheDocument();
  });

  it('ikinci şubede rol eklemek TAM LİSTEYİ gönderiyor', async () => {
    put.mockResolvedValue({
      data: [PRACTITIONER_B1, { id: 'm2', branchId: 'b2', roleKey: 'receptionist', roleName: 'Resepsiyon' }],
    });
    const user = userEvent.setup();
    const sheet = await openEditor(user);

    await user.click(within(sheet).getByRole('button', { name: 'Rol ekle' }));
    const roles = within(sheet).getAllByLabelText('Rol');
    const branches = within(sheet).getAllByLabelText('Şube');
    await user.selectOptions(roles[1]!, 'receptionist');
    await user.selectOptions(branches[1]!, 'b2');
    await user.click(within(sheet).getByRole('button', { name: 'Rolleri kaydet' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('users/u1/memberships', {
        memberships: [
          { roleKey: 'practitioner', branchId: 'b1' },
          { roleKey: 'receptionist', branchId: 'b2' },
        ],
      });
    });
  });

  it('aynı rol+şube iki kez eklenemiyor', async () => {
    const user = userEvent.setup();
    const sheet = await openEditor(user);

    await user.click(within(sheet).getByRole('button', { name: 'Rol ekle' }));
    await user.selectOptions(within(sheet).getAllByLabelText('Rol')[1]!, 'practitioner');
    await user.selectOptions(within(sheet).getAllByLabelText('Şube')[1]!, 'b1');

    expect(within(sheet).getByText('Bu rol bu şubede zaten var.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Rolleri kaydet' })).toBeDisabled();
  });

  it('şube yöneticisi, ERİŞEMEDİĞİ şubede de rolü olan kişiyi düzenleyemiyor', async () => {
    // PUT tam değiştirme ve gönderilen her şube erişim kontrolünden geçiyor:
    // Bodrum satırını "dokunmadan" geri göndermek bile 403 olurdu.
    me = MANAGER_B1;
    memberships = [
      PRACTITIONER_B1,
      { id: 'm2', branchId: 'b2', roleKey: 'practitioner', roleName: 'Uygulayıcı' },
    ];
    const user = userEvent.setup();
    const sheet = await openEditor(user);

    expect(await within(sheet).findByText(/erişiminiz olmayan bir şubede de rolü var/)).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Rolleri kaydet' })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Rol ekle' })).not.toBeInTheDocument();
  });

  it('sizden yetkili rol kilitli gösteriliyor ve olduğu gibi geri gönderiliyor', async () => {
    me = { ...MANAGER_B1, tenantWide: true };
    memberships = [
      { id: 'm0', branchId: null, roleKey: 'accountant', roleName: 'Muhasebe' },
      { id: 'm9', branchId: null, roleKey: 'owner', roleName: 'İşletme Sahibi' },
    ];
    put.mockResolvedValue({ data: memberships });
    const user = userEvent.setup();
    const sheet = await openEditor(user);

    expect(await within(sheet).findAllByText('Sizden yetkili bir rol — değiştirilemez.')).not.toHaveLength(0);
    await user.click(within(sheet).getByRole('button', { name: 'Rolü kaldır: Muhasebe' }));
    await user.click(within(sheet).getByRole('button', { name: 'Rolleri kaydet' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('users/u1/memberships', {
        memberships: [{ roleKey: 'owner' }],
      });
    });
  });

  it('kendi rollerini düzenleyemiyor', async () => {
    me = { ...OWNER, user: { id: 'u1' } };
    const user = userEvent.setup();
    const sheet = await openEditor(user);
    expect(await within(sheet).findByText(/Kendi rollerinizi değiştiremezsiniz/)).toBeInTheDocument();
  });

  it('tüm rolleri kaldırmak ayrıca onay istiyor', async () => {
    put.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    const sheet = await openEditor(user);

    await user.click(within(sheet).getByRole('button', { name: 'Rolü kaldır: Uygulayıcı' }));
    await user.click(within(sheet).getByRole('button', { name: 'Rolleri kaydet' }));
    expect(put).not.toHaveBeenCalled();

    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Rolleri kaldır' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('users/u1/memberships', { memberships: [] }));
  });
});
