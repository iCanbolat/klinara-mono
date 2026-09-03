import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContentBlockInput } from '@klinara/shared';
import { BlockList } from '../../src/components/editor/block-list';

const sections: ContentBlockInput[] = [
  { type: 'hero', title: 'Kapak' },
  { type: 'richText', body: 'Metin' },
  { type: 'contact' },
];

function renderList(overrides: Partial<Parameters<typeof BlockList>[0]> = {}) {
  const onMove = vi.fn();
  render(
    <BlockList
      sections={sections}
      selected={null}
      readOnly={false}
      onSelect={vi.fn()}
      onMove={onMove}
      onRemove={vi.fn()}
      onToggleVisible={vi.fn()}
      {...overrides}
    />,
  );
  return { onMove };
}

/**
 * web-booking erişilebilirlikte 100 aldı; editörün o çıtayı düşürmemesi
 * gerekiyor. Sıralamanın klavyeyle YAPILABİLİR ve DUYULABİLİR olması bu
 * dosyanın konusu.
 */
describe('blok listesi', () => {
  it('sıralama düğmeleri blok ADINI içeriyor', () => {
    // "Yukarı taşı" tek başına, ekran okuyucuda üç özdeş düğme demekti.
    renderList();
    expect(screen.getByRole('button', { name: 'Kapak bloğunu aşağı taşı' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Metin bloğunu yukarı taşı' })).toBeInTheDocument();
  });

  it('KLAVYEYLE sıralanabiliyor', async () => {
    const user = userEvent.setup();
    const { onMove } = renderList();

    await user.tab();
    await user.keyboard('{Enter}');
    // İlk odaklanabilir öge blok seçimi; taşımayı doğrudan düğmeden tetikliyoruz.
    await user.click(screen.getByRole('button', { name: 'Metin bloğunu yukarı taşı' }));
    expect(onMove).toHaveBeenCalledWith(1, 0);
  });

  it('taşıma ekran okuyucuya DUYURULUYOR', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'Metin bloğunu yukarı taşı' }));
    expect(await screen.findByText('Metin bloğu 1. sıraya taşındı')).toBeInTheDocument();
  });

  it('uçlardaki taşıma düğmeleri DEVRE DIŞI', () => {
    renderList();
    expect(screen.getByRole('button', { name: 'Kapak bloğunu yukarı taşı' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'İletişim bloğunu aşağı taşı' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kapak bloğunu aşağı taşı' })).toBeEnabled();
  });

  it('gizli blok İŞARETLİ ve durumu aria-pressed ile bildiriliyor', () => {
    renderList({
      sections: [{ type: 'hero', title: 'Kapak', visible: false }],
    });
    expect(screen.getByText('(Gizli)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /göster/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('salt-okunur modda düzenleme düğmeleri HİÇ render edilmiyor', () => {
    // Devre dışı bir düğme DOM'da durur ve ekran okuyucuya okunur; izni
    // olmayan kullanıcıya hiç göstermemek doğru.
    renderList({ readOnly: true });
    expect(screen.queryByRole('button', { name: /taşı/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sil/ })).not.toBeInTheDocument();
  });

  it('liste sıralı bir <ol> — sıra anlamlı', () => {
    renderList();
    expect(screen.getByRole('list').tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
