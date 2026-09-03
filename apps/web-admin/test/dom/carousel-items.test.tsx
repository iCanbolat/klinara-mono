import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CarouselItemInput } from '@klinara/shared';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { get, post } }));

const { CarouselItems } = await import('../../src/components/editor/carousel-items');

const ASSETS = [
  { id: 'a1111111-1111-4111-8111-111111111111', altText: 'Bekleme salonu' },
  { id: 'a2222222-2222-4222-8222-222222222222', altText: 'Muayene odası' },
];

const items: CarouselItemInput[] = [
  { assetId: ASSETS[0]!.id, alt: 'Bekleme salonu' },
  { assetId: ASSETS[1]!.id },
];

function renderItems(overrides: Partial<Parameters<typeof CarouselItems>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <CarouselItems
      label="Görseller"
      items={items}
      readOnly={false}
      error={undefined}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

/**
 * Faz 11.5'te bu alan salt okunur bir sayaçtı. Bu dosya kapatılan maddenin
 * kabul kriterlerini tutuyor: sıralama KLAVYEYLE yapılabilir olmalı ve
 * kütüphanede bulunmayan bir kimlik seçili kalabilmeli.
 */
describe('karusel öge editörü', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue(ASSETS);
  });

  it('sıralama düğmeleri SIRA NUMARASI taşıyor', async () => {
    renderItems();
    expect(
      await screen.findByRole('button', { name: '2. görseli yukarı taşı' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1. görseli aşağı taşı' })).toBeInTheDocument();
  });

  it('ilk ögenin "yukarı" ve son ögenin "aşağı" düğmesi kapalı', async () => {
    renderItems();
    expect(await screen.findByRole('button', { name: '1. görseli yukarı taşı' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2. görseli aşağı taşı' })).toBeDisabled();
  });

  it('taşıma sırayı DEĞİŞTİRİYOR', async () => {
    const user = userEvent.setup();
    const { onChange } = renderItems();
    await user.click(await screen.findByRole('button', { name: '2. görseli yukarı taşı' }));
    expect(onChange).toHaveBeenCalledWith([items[1], items[0]]);
  });

  it('silme yalnız o ögeyi çıkarıyor', async () => {
    const user = userEvent.setup();
    const { onChange } = renderItems();
    await user.click(await screen.findByRole('button', { name: '1. görseli sil' }));
    expect(onChange).toHaveBeenCalledWith([items[1]]);
  });

  it('boşaltılan alternatif metin ALANIN KENDİSİNİ siliyor', async () => {
    const user = userEvent.setup();
    const { onChange } = renderItems();
    const inputs = await screen.findAllByLabelText('Alternatif metin');
    await user.clear(inputs[0]!);
    expect(onChange).toHaveBeenLastCalledWith([{ assetId: ASSETS[0]!.id }, items[1]]);
  });

  it('KRİTİK: kütüphanede olmayan kimlik seçili KALIYOR', async () => {
    // Başka bir kullanıcı varlığı silmiş olabilir. Seçenek listesine
    // eklenmezse `select` ilk ögeye kayar ve blok, kullanıcı hiç dokunmadan
    // BAŞKA bir görseli işaret eder.
    renderItems({ items: [{ assetId: 'a9999999-9999-4999-8999-999999999999' }] });
    const select = await screen.findByRole('combobox', { name: '1. görselin kaynağı' });
    expect(select).toHaveValue('a9999999-9999-4999-8999-999999999999');
  });

  it('salt okunur modda sıralama ve silme düğmeleri YOK', async () => {
    renderItems({ readOnly: true });
    expect(await screen.findAllByLabelText('Alternatif metin')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '1. görseli sil' })).not.toBeInTheDocument();
  });

  it('sınır dolduğunda ekleme kapanıyor', async () => {
    const full = Array.from({ length: 20 }, () => ({ assetId: ASSETS[0]!.id }));
    renderItems({ items: full });
    expect(await screen.findByRole('button', { name: 'Görsel ekle' })).toBeDisabled();
  });
});
