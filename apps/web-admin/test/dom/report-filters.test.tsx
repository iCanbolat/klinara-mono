import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const branchState = {
  branches: [
    { id: 'b1111111-1111-4111-8111-111111111111', name: 'Nişantaşı', timezone: 'Europe/Istanbul' },
    { id: 'b2222222-2222-4222-8222-222222222222', name: 'Kadıköy', timezone: 'Europe/Istanbul' },
  ],
  branchId: null as string | null,
  setBranchId: vi.fn(),
  canSelectAll: true,
  loading: false,
};

vi.mock('@/components/session/branch-provider', () => ({
  useBranch: () => branchState,
}));

const { ReportFilters } = await import('../../src/components/reports/report-filters');

function renderFilters(overrides: Partial<Parameters<typeof ReportFilters>[0]> = {}) {
  const onPresetChange = vi.fn();
  const onCompareChange = vi.fn();
  render(
    <ReportFilters
      preset="thisMonth"
      onPresetChange={onPresetChange}
      compare={false}
      onCompareChange={onCompareChange}
      {...overrides}
    />,
  );
  return { onPresetChange, onCompareChange };
}

describe('rapor süzgeci', () => {
  it('"Tüm şubeler" YALNIZ kiracı geneli rollerde çıkıyor', () => {
    branchState.canSelectAll = true;
    renderFilters();
    expect(screen.getByRole('option', { name: 'Tüm şubeler' })).toBeInTheDocument();

    cleanupAndRender(() => {
      branchState.canSelectAll = false;
      renderFilters();
    });
    // Şube kapsamlı kullanıcı için boş değer "erişebildiğim şubeler" anlamına
    // gelirdi; "tüm şubeler" demek göremediği şubeleri de kapsıyormuş gibi
    // okunurdu.
    expect(screen.queryByRole('option', { name: 'Tüm şubeler' })).not.toBeInTheDocument();
    branchState.canSelectAll = true;
  });

  it('şube seçimi sağlayıcıya bildiriliyor', async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.selectOptions(screen.getByLabelText('Şube'), branchState.branches[1]!.id);
    expect(branchState.setBranchId).toHaveBeenCalledWith(branchState.branches[1]!.id);
  });

  it('kırılım seçici YALNIZ seçenek verildiğinde render ediliyor', () => {
    renderFilters();
    expect(screen.queryByLabelText('Kırılım')).not.toBeInTheDocument();

    cleanupAndRender(() =>
      renderFilters({
        groupBy: 'staff',
        groupOptions: [
          { value: 'staff', label: 'Personel' },
          { value: 'day', label: 'Gün' },
        ],
        onGroupByChange: vi.fn(),
      }),
    );
    expect(screen.getByLabelText('Kırılım')).toBeInTheDocument();
  });

  it('karşılaştırma kutusu değişimi bildiriyor', async () => {
    const user = userEvent.setup();
    const { onCompareChange } = renderFilters();
    await user.click(screen.getByLabelText('Önceki dönemle karşılaştır'));
    expect(onCompareChange).toHaveBeenCalledWith(true);
  });

  it('dönem etiketi KAPSAYICI görünüyor', () => {
    renderFilters({ preset: 'lastMonth' });
    const label = screen.getByText(/–/).textContent ?? '';

    // `\w` Türkçe harfleri KAPSAMIYOR ("Ağustos"taki "ğ"); ay adı `\p{L}` ile
    // eşleşiyor ve dizge `u` bayrağı istiyor.
    const match = /^(\d{1,2}) \p{L}+ (\d{4}) – (\d{1,2}) \p{L}+ (\d{4})$/u.exec(label);
    expect(match, label).not.toBeNull();

    // Asıl iddia: geçen ay etiketinin BİTİŞİ ayın son günü, bir sonraki ayın
    // 1'i değil. Sunucuya "1 Eylül hariç" diyoruz ama kullanıcıya "31 Ağustos"
    // göstermeliyiz. Gün numarasına bakmak, testi hangi ayda koşulursa
    // koşulsun anlamlı tutuyor (her ayın son günü ≥ 28).
    expect(Number(match?.[1])).toBe(1);
    expect(Number(match?.[3])).toBeGreaterThanOrEqual(28);
  });
});

/** Testler arası temizlik `setup.ts`te; aynı test içinde yeniden render için. */
function cleanupAndRender(render: () => void): void {
  document.body.innerHTML = '';
  render();
}
