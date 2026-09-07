import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@klinara/shared';

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();
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
  api: { get, put, post, delete: del },
  ApiProblemError,
  SessionExpiredError,
}));

let branchState: { branchId: string | null; loading: boolean; branches: never[]; canSelectAll: boolean } = {
  branchId: 'b1',
  loading: false,
  branches: [],
  canSelectAll: true,
};
vi.mock('@/components/session/branch-provider', () => ({ useBranch: () => branchState }));

let permissions: string[] = [PERMISSIONS.SCHEDULE_READ, PERMISSIONS.SCHEDULE_WRITE];
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me: null, loading: false }),
}));

const { WorkingHoursPage } = await import('../../src/components/schedule/working-hours-page');

describe('çalışma saatleri', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    permissions = [PERMISSIONS.SCHEDULE_READ, PERMISSIONS.SCHEDULE_WRITE];
    branchState = { branchId: 'b1', loading: false, branches: [], canSelectAll: true };

    get.mockImplementation((path: string) => {
      if (path.startsWith('branches/')) {
        return Promise.resolve({
          branchId: 'b1',
          // Sunucu YALNIZ tanımlı günleri döndürüyor: Pazartesi ve Salı.
          entries: [
            { dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '18:00' },
            { dayOfWeek: 2, isClosed: false, openTime: '09:00', closeTime: '18:00' },
          ],
        });
      }
      if (path === 'staff') return Promise.resolve({ data: [] });
      if (path.startsWith('schedule-exceptions')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    put.mockResolvedValue({});
  });

  it('kaydetme HAFTANIN TAMAMINI gönderiyor', async () => {
    // ⚠️ EN KRİTİK İDDİA.
    // `PUT` TAM DEĞİŞTİRME: gönderilmeyen gün SİLİNİR. Sunucu yalnız iki gün
    // döndürdü; kaydettiğimizde yedi gün gitmeli, yoksa kalan beş gün
    // kalıcı olarak yok olur.
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await screen.findByRole('button', { name: 'Haftayı kaydet' });
    await user.click(screen.getByRole('button', { name: 'Haftayı kaydet' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledTimes(1);
    });

    const body = put.mock.calls[0]?.[1] as { entries: { dayOfWeek: number }[] };
    expect(body.entries).toHaveLength(7);
    expect(body.entries.map((entry) => entry.dayOfWeek).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('şube HEM YOLDA HEM BAŞLIKTA gidiyor', async () => {
    // Uç `@RequireBranchScope()` taşıyor; başlıksız istek 400.
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await screen.findByRole('button', { name: 'Haftayı kaydet' });
    await user.click(screen.getByRole('button', { name: 'Haftayı kaydet' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith(
        'branches/b1/hours',
        expect.anything(),
        expect.objectContaining({ branchId: 'b1' }),
      );
    });
  });

  it('sunucunun DÖNMEDİĞİ günler KAPALI olarak yükleniyor', async () => {
    // Eksik günü açık varsaymak kullanıcıya "pazar da açığız" derdi.
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    await screen.findByRole('button', { name: 'Haftayı kaydet' });
    await user.click(screen.getByRole('button', { name: 'Haftayı kaydet' }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0]?.[1] as { entries: { dayOfWeek: number; isClosed: boolean }[] };
    expect(body.entries.find((entry) => entry.dayOfWeek === 0)?.isClosed).toBe(true);
    expect(body.entries.find((entry) => entry.dayOfWeek === 1)?.isClosed).toBe(false);
  });

  it('GEÇERSİZ saatte kaydet ETKİSİZ ve sebep gün adıyla yazılı', async () => {
    const user = userEvent.setup();
    render(<WorkingHoursPage />);

    const openInputs = await screen.findAllByLabelText('Açılış');
    // Pazartesi ekranda ilk sırada (hafta pazartesi başlıyor).
    await user.clear(openInputs[0] as HTMLInputElement);
    await user.type(openInputs[0] as HTMLInputElement, '19:00');

    expect(await screen.findByText(/Pazartesi.*Kapanış/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Haftayı kaydet' })).toBeDisabled();
  });

  it('yazma izni YOKKEN kaydet düğmesi yok', async () => {
    permissions = [PERMISSIONS.SCHEDULE_READ];
    render(<WorkingHoursPage />);

    await screen.findByText(/Resmî tatiller/);
    expect(screen.queryByRole('button', { name: 'Haftayı kaydet' })).not.toBeInTheDocument();
  });

  it('TATİLLERİN yönetilemediği açıkça söyleniyor', async () => {
    // Boş bir "tatiller" sekmesi "tatil tanımlı değil" derdi — yanlış.
    render(<WorkingHoursPage />);
    expect(await screen.findByText(/Resmî tatiller şu an panelden yönetilemiyor/)).toBeInTheDocument();
  });

  it('şube seçili DEĞİLKEN istek atmıyor', () => {
    branchState = { branchId: null, loading: false, branches: [], canSelectAll: true };
    render(<WorkingHoursPage />);

    expect(get.mock.calls.filter((c) => String(c[0]).startsWith('branches/'))).toHaveLength(0);
    expect(screen.getByText(/şube seçin/i)).toBeInTheDocument();
  });
});
