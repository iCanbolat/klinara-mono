import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxOption } from '../../src/components/ui/combobox';

const AYSE: ComboboxOption = { id: 'c1', label: 'Ayşe Yılmaz', hint: '+90 532 111 22 33' };
const MEHMET: ComboboxOption = { id: 'c2', label: 'Mehmet Demir', hint: '+90 532 444 55 66' };

function renderBox(overrides: Partial<Parameters<typeof Combobox>[0]> = {}) {
  const onSelect = vi.fn();
  const search = vi.fn<(q: string, s: AbortSignal) => Promise<ComboboxOption[]>>();
  search.mockResolvedValue([AYSE, MEHMET]);

  render(
    <Combobox
      label="Müşteri"
      value={null}
      onSelect={onSelect}
      search={search}
      placeholder="Ad veya telefon"
      {...overrides}
    />,
  );
  return { onSelect, search };
}

describe('combobox', () => {
  it('ASGARİ uzunluğun altında arama YAPMAZ', async () => {
    // `GET /customers/search` `q` için en az 2 karakter istiyor; tek harfle
    // sormak garantili bir 400 demek.
    const user = userEvent.setup();
    const { search } = renderBox();

    await user.type(screen.getByRole('combobox'), 'a');
    expect(await screen.findByText(/en az 2 karakter/i)).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  it('yazınca aramayı çağırıyor ve sonuçları listeliyor', async () => {
    const user = userEvent.setup();
    const { search } = renderBox();

    await user.type(screen.getByRole('combobox'), 'yılmaz');

    expect(await screen.findByRole('option', { name: /Ayşe Yılmaz/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Mehmet Demir/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('yılmaz', expect.any(AbortSignal));
    });
  });

  it('seçince onSelect KAYDIN KENDİSİYLE tetikleniyor', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderBox();

    await user.type(screen.getByRole('combobox'), 'yılmaz');
    await user.click(await screen.findByRole('option', { name: /Ayşe Yılmaz/ }));

    // Yalnız id değil tüm kayıt: çağıran seçili adı göstermek için ikinci bir
    // istek atmak zorunda kalmasın.
    expect(onSelect).toHaveBeenCalledWith(AYSE);
  });

  it('KLAVYEYLE gezinip seçilebiliyor', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderBox();
    const input = screen.getByRole('combobox');

    await user.type(input, 'yılmaz');
    await screen.findByRole('option', { name: /Ayşe Yılmaz/ });

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(MEHMET);
  });

  it('etkin seçenek aria-activedescendant ile DUYURULUYOR', async () => {
    const user = userEvent.setup();
    renderBox();
    const input = screen.getByRole('combobox');

    await user.type(input, 'yılmaz');
    await screen.findByRole('option', { name: /Ayşe Yılmaz/ });

    // Odak girdide KALIYOR (listeye gitmiyor); ekran okuyucu etkin seçeneği
    // bu bağdan okuyor. Bağ kopuk olsaydı klavye gezinmesi görsel olarak
    // çalışır ama sesli okumada hiçbir şey değişmezdi.
    const first = input.getAttribute('aria-activedescendant');
    expect(first).not.toBeNull();
    expect(document.getElementById(first ?? '')).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(input.getAttribute('aria-activedescendant')).not.toBe(first);
    });
  });

  it('sonuç yoksa açıklama ve ek eylem gösteriliyor', async () => {
    const user = userEvent.setup();
    const search = vi.fn<(q: string, s: AbortSignal) => Promise<ComboboxOption[]>>();
    search.mockResolvedValue([]);

    render(
      <Combobox
        label="Müşteri"
        value={null}
        onSelect={vi.fn()}
        search={search}
        emptyAction={<button type="button">Yeni müşteri</button>}
      />,
    );

    await user.type(screen.getByRole('combobox'), 'bulunmaz');

    expect(await screen.findByText(/Sonuç bulunamadı/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni müşteri' })).toBeInTheDocument();
  });

  it('Esc listeyi kapatıyor', async () => {
    const user = userEvent.setup();
    renderBox();
    const input = screen.getByRole('combobox');

    await user.type(input, 'yılmaz');
    await screen.findByRole('option', { name: /Ayşe Yılmaz/ });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('seçim varken ARAMA GİRDİSİ gösterilmiyor', () => {
    // Girdiyi seçili metinle doldurmak yaygın ama kötü: kullanıcı yazmaya
    // başladığında seçimin hâlâ geçerli olup olmadığı belirsizleşir.
    renderBox({ value: AYSE });

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Ayşe Yılmaz')).toBeInTheDocument();
  });

  it('"Değiştir" seçimi BOŞALTIYOR', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderBox({ value: AYSE });

    await user.click(screen.getByRole('button', { name: 'Değiştir' }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('clearable=false iken seçim boşaltılamıyor', () => {
    renderBox({ value: AYSE, clearable: false });
    expect(screen.queryByRole('button', { name: 'Değiştir' })).not.toBeInTheDocument();
  });

  it('hata mesajı role="alert" ile ve girdiye BAĞLI', async () => {
    renderBox({ error: 'Müşteri seçilmeli' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Müşteri seçilmeli');
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });
});
