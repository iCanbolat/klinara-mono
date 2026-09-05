import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * Şube sağlayıcısı — API'nin ZARFINI açtığını sabitleyen test.
 *
 * `GET branches` yanıtı `{ data: [...] }`; sağlayıcı bir dönem bunu düz dizi
 * sanıp nesneyi olduğu gibi state'e koyuyordu ve hata sağlayıcıda değil,
 * `branches.map`i çağıran rapor süzgecinde patlıyordu. `report-filters` testi
 * sağlayıcıyı mock'ladığı için bunu göremezdi — bu yüzden burada GERÇEK
 * sağlayıcı, mock'lanan tek şey `api`.
 */

const get = vi.fn();
const session = { me: null as unknown, loading: false, permissions: [], reload: vi.fn() };

class SessionExpiredError extends Error {}

vi.mock('@/lib/api/client', () => ({
  api: { get: (path: string) => get(path) as unknown },
  SessionExpiredError,
}));

vi.mock('@/components/session/session-provider', () => ({
  useSession: () => session,
}));

const { BranchProvider, useBranch } = await import('../../src/components/session/branch-provider');

const BRANCHES = [
  { id: 'b1111111-1111-4111-8111-111111111111', name: 'Nişantaşı', timezone: 'Europe/Istanbul' },
  { id: 'b2222222-2222-4222-8222-222222222222', name: 'Kadıköy', timezone: 'Europe/Istanbul' },
];

function Probe() {
  const { branches, branchId } = useBranch();
  return (
    <ul data-testid="branches" data-selected={branchId ?? ''}>
      {branches.map((branch) => (
        <li key={branch.id}>{branch.name}</li>
      ))}
    </ul>
  );
}

beforeEach(() => {
  get.mockReset();
  session.me = { id: 'u1', tenantWide: true };
  globalThis.localStorage?.clear();
});

describe('şube sağlayıcısı', () => {
  it('zarflı yanıtı açıyor', async () => {
    get.mockResolvedValue({ data: BRANCHES });
    render(
      <BranchProvider>
        <Probe />
      </BranchProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Nişantaşı')).toBeInTheDocument();
    });
    expect(screen.getByText('Kadıköy')).toBeInTheDocument();
  });

  it('şube kapsamlı kullanıcıda ilk şube seçili geliyor', async () => {
    session.me = { id: 'u1', tenantWide: false };
    get.mockResolvedValue({ data: BRANCHES });
    render(
      <BranchProvider>
        <Probe />
      </BranchProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('branches')).toHaveAttribute('data-selected', BRANCHES[0]!.id);
    });
  });

  it('liste alınamazsa boş dizi kalıyor — süzgeç çökmüyor', async () => {
    get.mockRejectedValue(new Error('kopuk'));
    render(
      <BranchProvider>
        <Probe />
      </BranchProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('branches')).toBeEmptyDOMElement();
    });
  });
});
