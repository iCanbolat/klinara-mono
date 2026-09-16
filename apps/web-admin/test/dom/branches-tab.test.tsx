import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@klinara/shared';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

class SessionExpiredError extends Error {}
class ApiProblemError extends Error {
  constructor(
    readonly problem: { code: string; status: number; title: string; detail?: string; requestId: string },
    readonly retryAfterSeconds: number | null,
  ) {
    super(problem.code);
  }
}

vi.mock('@/lib/api/client', () => ({
  api: { get, post, patch, put: vi.fn(), delete: vi.fn() },
  ApiProblemError,
  SessionExpiredError,
}));

const reloadProvider = vi.fn();
vi.mock('@/components/session/branch-provider', () => ({
  useBranch: () => ({
    branchId: 'b1',
    loading: false,
    branches: [],
    canSelectAll: true,
    setBranchId: vi.fn(),
    reload: reloadProvider,
  }),
}));

let permissions: string[] = [];
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me: null, loading: false }),
}));

const { BranchesTab } = await import('../../src/components/branches/branches-tab');

const NISANTASI = {
  id: 'b1',
  tenantId: 't1',
  slug: 'nisantasi',
  name: 'Nişantaşı',
  timezone: 'Europe/Istanbul',
  phone: null,
  address: 'Teşvikiye Cad. 12',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};
const KADIKOY = { ...NISANTASI, id: 'b3', slug: 'kadikoy', name: 'Kadıköy', address: null, isActive: false };

const STAFF = [
  { id: 'p1', userId: 'u1', isActive: true, primaryBranchId: 'b1', branchIds: ['b1'] },
  { id: 'p2', userId: 'u2', isActive: true, primaryBranchId: null, branchIds: ['b1', 'b3'] },
  { id: 'p3', userId: 'u3', isActive: false, primaryBranchId: 'b1', branchIds: [] },
];

describe('şubeler sekmesi', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    reloadProvider.mockReset();
    permissions = [PERMISSIONS.BRANCH_READ, PERMISSIONS.BRANCH_WRITE];
    get.mockImplementation((path: string) => {
      if (path === 'branches') return Promise.resolve({ data: [KADIKOY, NISANTASI] });
      if (path === 'staff') return Promise.resolve({ data: STAFF });
      return Promise.resolve({ data: [] });
    });
  });

  it('aktif şube önce, pasif rozetli; personel sayısı pasif personeli saymıyor', async () => {
    render(<BranchesTab />);
    const rows = await screen.findAllByRole('row');
    expect(rows[1]).toHaveTextContent('Nişantaşı');
    expect(rows[1]).toHaveTextContent('2 personel');
    expect(rows[2]).toHaveTextContent('Kadıköy');
    expect(rows[2]).toHaveTextContent('Pasif');
    expect(rows[2]).toHaveTextContent('1 personel');
  });

  it('yeni şube: kod addan türetiliyor, kayıttan sonra panelin şube listesi yenileniyor', async () => {
    post.mockResolvedValue({ ...NISANTASI, id: 'b4', slug: 'izmir-alsancak', name: 'İzmir Alsancak' });
    const user = userEvent.setup();
    render(<BranchesTab />);

    await user.click(await screen.findByRole('button', { name: 'Yeni şube' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Şube adı'), 'İzmir Alsancak');
    expect(within(dialog).getByLabelText('Şube kodu')).toHaveValue('izmir-alsancak');
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('branches', {
        slug: 'izmir-alsancak',
        name: 'İzmir Alsancak',
        timezone: 'Europe/Istanbul',
      }),
    );
    await waitFor(() => expect(reloadProvider).toHaveBeenCalled());
  });

  it('pasife almak onay istiyor ve yalnız değişen alanı gönderiyor', async () => {
    patch.mockResolvedValue({ ...NISANTASI, isActive: false });
    const user = userEvent.setup();
    render(<BranchesTab />);

    const rows = await screen.findAllByRole('row');
    await user.click(within(rows[1]!).getByRole('button', { name: 'Düzenle' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Şube kodu')).toHaveAttribute('readonly');
    await user.click(within(dialog).getByRole('switch', { name: 'Aktif' }));
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

    expect(patch).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Pasife al' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('branches/b1', { isActive: false }));
  });

  it('branch:write YOKKEN ekleme/düzenleme yok', async () => {
    permissions = [PERMISSIONS.BRANCH_READ];
    render(<BranchesTab />);
    await screen.findAllByText('Nişantaşı');
    expect(screen.queryByRole('button', { name: 'Yeni şube' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Düzenle' })).not.toBeInTheDocument();
    expect(screen.getByText(/yalnız işletme sahibi/)).toBeInTheDocument();
  });
});
