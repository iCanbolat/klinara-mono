import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DnsRecord } from '../../src/components/domains/dns-record';

/**
 * Batch 11.6 kabul kriteri: kullanıcı DNS değerlerini ELLE YAZMAK ZORUNDA
 * KALMAMALI. Bu dosya tam da onu iddia ediyor.
 */
describe('DNS kaydı', () => {
  const writeText = vi.fn<(value: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
  });

  /**
   * ⚠️ Pano taklidi `userEvent.setup()`TEN SONRA kurulmak zorunda: user-event
   * v14 kurulum sırasında `navigator.clipboard`ın üzerine kendi stub'ını
   * yazıyor ve önce kurulan taklit sessizce kaybolur — test yeşil kalıp
   * hiçbir şey doğrulamazdı.
   */
  function setup(): ReturnType<typeof userEvent.setup> {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return user;
  }

  it('tip, ad ve değer için AYRI kopyalama düğmeleri var', () => {
    // Birleşik tek düğme, DNS panellerinin ayrı alanları yüzünden kullanıcıyı
    // elle bölmeye zorlardı — yani kaçındığımız şeye.
    render(<DnsRecord type="TXT" name="_klinara-verify.klinikx.com" value="klinara-verify-abc" />);

    const buttons = screen.getAllByRole('button', { name: /Kopyala/ });
    expect(buttons).toHaveLength(3);
  });

  it('her düğme KENDİ değerini kopyalıyor', async () => {
    const user = setup();
    render(<DnsRecord type="TXT" name="_klinara-verify.klinikx.com" value="klinara-verify-abc" />);

    await user.click(screen.getByRole('button', { name: /Tip: Kopyala/ }));
    expect(writeText).toHaveBeenLastCalledWith('TXT');

    await user.click(screen.getByRole('button', { name: /Ad: Kopyala/ }));
    expect(writeText).toHaveBeenLastCalledWith('_klinara-verify.klinikx.com');

    await user.click(screen.getByRole('button', { name: /Değer: Kopyala/ }));
    expect(writeText).toHaveBeenLastCalledWith('klinara-verify-abc');
  });

  it('kopyalama ekran okuyucuya DUYURULUYOR', async () => {
    const user = setup();
    render(<DnsRecord type="CNAME" name="klinikx.com" value="klinik-x.klinara.app" />);

    await user.click(screen.getByRole('button', { name: /Değer: Kopyala/ }));
    expect(await screen.findByText('Kopyalandı')).toBeInTheDocument();
  });

  it('değerler SEÇİLEBİLİR metin olarak da duruyor — pano yedeği', async () => {
    // Pano izni reddedilirse ya da bağlam güvensizse kullanıcı elle seçebilmeli.
    render(<DnsRecord type="TXT" name="_klinara-verify.klinikx.com" value="klinara-verify-abc" />);
    expect(screen.getByText('klinara-verify-abc').tagName).toBe('CODE');
    expect(screen.getByText('_klinara-verify.klinikx.com').tagName).toBe('CODE');
  });

  it('pano reddedilirse ÇÖKMÜYOR', async () => {
    writeText.mockRejectedValue(new Error('izin yok'));
    const user = setup();
    render(<DnsRecord type="TXT" name="a" value="b" />);

    await user.click(screen.getByRole('button', { name: /Değer: Kopyala/ }));
    // "Kopyalandı" duyurusu YAPILMIYOR — yalan söylemiyoruz.
    expect(screen.queryByText('Kopyalandı')).not.toBeInTheDocument();
  });
});
