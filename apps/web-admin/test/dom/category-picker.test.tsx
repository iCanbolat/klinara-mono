import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { get } }));

const { CategoryPicker } = await import('../../src/components/editor/category-picker');

const CATEGORIES = [
  { id: 'c1111111-1111-4111-8111-111111111111', slug: 'epilasyon', name: 'Epilasyon', sortOrder: 0, isActive: true },
  { id: 'c2222222-2222-4222-8222-222222222222', slug: 'cilt', name: 'Cilt bakımı', sortOrder: 1, isActive: true },
  { id: 'c3333333-3333-4333-8333-333333333333', slug: 'eski', name: 'Eski hizmetler', sortOrder: 2, isActive: false },
];

function renderPicker(overrides: Partial<Parameters<typeof CategoryPicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <CategoryPicker
      label="Kategoriler (boş = tümü)"
      selected={[]}
      maxItems={30}
      readOnly={false}
      error={undefined}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

describe('kategori süzgeci', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: CATEGORIES });
  });

  it('kategorileri ADLARIYLA listeliyor, pasif olanı işaretliyor', async () => {
    renderPicker();
    expect(await screen.findByRole('checkbox', { name: 'Epilasyon' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Eski hizmetler \(pasif\)/ })).toBeInTheDocument();
  });

  it('seçim eklemek listeyi büyütüyor', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    await user.click(await screen.findByRole('checkbox', { name: 'Epilasyon' }));
    expect(onChange).toHaveBeenCalledWith([CATEGORIES[0]!.id]);
  });

  it('son seçim kaldırılınca alan SİLİNİYOR (boş dizi değil)', async () => {
    // `[]` ile `undefined` aynı anlama geliyor ("tümü"); ikincisi içeriğe
    // gereksiz bir alan yazmıyor ve `content_hash`ı kirletmiyor.
    const user = userEvent.setup();
    const { onChange } = renderPicker({ selected: [CATEGORIES[0]!.id] });
    await user.click(await screen.findByRole('checkbox', { name: 'Epilasyon' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('sınır dolduğunda YALNIZ seçilmemiş kutular kilitleniyor', async () => {
    renderPicker({ selected: [CATEGORIES[0]!.id], maxItems: 1 });
    expect(await screen.findByRole('checkbox', { name: 'Epilasyon' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Cilt bakımı' })).toBeDisabled();
  });

  it('KRİTİK: liste okunamazsa seçim SİLİNMİYOR', async () => {
    // Uç `service:read` istiyor. İzni olmayan bir içerik editörü 403 alır;
    // kutuları gizleyip seçimi de boşaltmak, kullanıcının göremediği bir
    // süzgeci sessizce kaldırmak olurdu.
    get.mockRejectedValue(new Error('403'));
    const { onChange } = renderPicker({ selected: [CATEGORIES[0]!.id, CATEGORIES[1]!.id] });
    expect(await screen.findByText('2 kategori seçili')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('listede bulunmayan seçim KALDIRILABİLİR kalıyor', async () => {
    const user = userEvent.setup();
    const orphan = 'c9999999-9999-4999-8999-999999999999';
    const { onChange } = renderPicker({ selected: [orphan] });
    await user.click(await screen.findByRole('checkbox', { name: /Bilinmeyen kategori/ }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
