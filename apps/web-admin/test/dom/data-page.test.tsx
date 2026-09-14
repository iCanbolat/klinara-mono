import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataPage, type DataPagePagination } from '../../src/components/data-page/data-page';
import { pageWindow } from '../../src/components/data-page/pagination';

interface Row {
  id: string;
  name: string;
}

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: `r${index + 1}`, name: `Kayıt ${index + 1}` }));

function Harness({
  data,
  pagination = { mode: 'client', pageSize: 10 },
  loading = false,
  error = null,
  resetKey,
}: {
  data: Row[];
  pagination?: DataPagePagination;
  loading?: boolean;
  error?: string | null;
  resetKey?: string;
}): ReactNode {
  return (
    <DataPage
      title="Liste"
      rows={data}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      emptyTitle="Boş"
      viewStorageKey="test.view"
      pagination={pagination}
      {...(resetKey === undefined ? {} : { resetKey })}
      renderTable={(visible) => (
        <table>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      renderCard={(row) => <article>{row.name}</article>}
    />
  );
}

/** `lg` altı (tablet/telefon) — `max-width` sorgusu eşleşiyor. */
function mockBelowLg(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe('DataPage', () => {
  beforeEach(() => {
    localStorage.clear();
    mockBelowLg(false);
  });
  afterEach(() => {
    mockBelowLg(false);
  });

  it('client sayfalama dilimliyor ve sayfalar arasında geziyor', async () => {
    const user = userEvent.setup();
    render(<Harness data={rows(25)} />);

    expect(screen.getByText('Kayıt 10')).toBeInTheDocument();
    expect(screen.queryByText('Kayıt 11')).not.toBeInTheDocument();
    expect(screen.getByText('1–10 / 25')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '3. sayfa' }));
    expect(screen.getByText('Kayıt 25')).toBeInTheDocument();
    expect(screen.queryByText('Kayıt 10')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sonraki' })).toBeDisabled();
  });

  it('resetKey değişince 1. sayfaya dönüyor', async () => {
    const user = userEvent.setup();

    function Filtered(): ReactNode {
      const [key, setKey] = useState('a');
      return (
        <>
          <button type="button" onClick={() => setKey('b')}>
            süz
          </button>
          <Harness data={rows(25)} resetKey={key} />
        </>
      );
    }

    render(<Filtered />);
    await user.click(screen.getByRole('button', { name: '2. sayfa' }));
    expect(screen.getByText('Kayıt 11')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'süz' }));
    expect(screen.getByText('Kayıt 1')).toBeInTheDocument();
    expect(screen.queryByText('Kayıt 11')).not.toBeInTheDocument();
  });

  it('liste küçülünce boş bir sayfada kalmıyor', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness data={rows(25)} />);
    await user.click(screen.getByRole('button', { name: '3. sayfa' }));

    rerender(<Harness data={rows(15)} />);
    expect(screen.getByText('Kayıt 15')).toBeInTheDocument();
  });

  it('tek sayfada sayfalama render edilmiyor', () => {
    render(<Harness data={rows(3)} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('server modunda Önceki/Sonraki durumları ve geri çağrılar', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(
      <Harness
        data={rows(50)}
        pagination={{ mode: 'server', pageIndex: 0, hasPrev: false, hasNext: true, onNext, onPrev }}
      />,
    );

    // Server modunda dilimleme YOK: sayfanın verdiği satırların hepsi çiziliyor.
    expect(screen.getByText('Kayıt 50')).toBeInTheDocument();
    expect(screen.getByText('Sayfa 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Önceki' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Sonraki' }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it('tablo ↔ kart geçişi çalışıyor ve tercih saklanıyor', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness data={rows(2)} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Görünüm' });
    await user.click(within(group).getByRole('button', { name: 'Kart' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(localStorage.getItem('test.view')).toBe('card');

    unmount();
    render(<Harness data={rows(2)} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('tablet ve altında kart ZORUNLU, geçiş gösterilmiyor, tercih silinmiyor', () => {
    localStorage.setItem('test.view', 'table');
    mockBelowLg(true);
    render(<Harness data={rows(2)} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('group', { name: 'Görünüm' })).not.toBeInTheDocument();
    expect(localStorage.getItem('test.view')).toBe('table');
  });

  it('yükleniyor, hata ve boş durumları', () => {
    const { rerender } = render(<Harness data={[]} loading />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('Boş')).not.toBeInTheDocument();

    rerender(<Harness data={[]} error="Bir şey ters gitti" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Bir şey ters gitti');
    expect(screen.queryByText('Boş')).not.toBeInTheDocument();

    rerender(<Harness data={[]} />);
    expect(screen.getByText('Boş')).toBeInTheDocument();
  });
});

describe('pageWindow', () => {
  it('ilk, son ve geçerli ±1; boşluklar üç nokta', () => {
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    // Tek sayfalık boşluk numarasıyla dolduruluyor.
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, null, 10]);
  });
});
