import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicSitePayload } from '@klinara/shared';
import { renderableBlocks } from '../../src/components/blocks/registry';
import { Markdown } from '../../src/components/blocks/markdown';
import { Faq, ServiceList } from '../../src/components/blocks/blocks';

describe('blok süzgeci', () => {
  it('sözlükte olmayan blok türünü SESSİZCE atlıyor', () => {
    // API blok sözlüğünü büyüttüğünde eski istemci beyaz ekran vermemeli;
    // bu, 11.1'in kabul kriteri.
    const blocks = renderableBlocks([
      { type: 'hero', title: 'A' },
      { type: 'video', url: 'x' },
      { type: 'richText', body: 'B' },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['hero', 'richText']);
  });

  it('gizli bloğu atlıyor', () => {
    expect(renderableBlocks([{ type: 'hero', title: 'A', visible: false }])).toHaveLength(0);
  });

  it('bozuk girdide çökmüyor', () => {
    expect(renderableBlocks(null)).toEqual([]);
    expect(renderableBlocks([null, 'x', 42, {}])).toEqual([]);
  });
});

describe('markdown renderer', () => {
  it('başlık, liste ve satır içi biçimlendirmeyi çiziyor', () => {
    const { container } = render(
      <Markdown source={'# Başlık\n\nBir **kalın** ve *italik*.\n\n- bir\n- iki'} />,
    );
    expect(container.querySelector('h2')?.textContent).toBe('Başlık');
    expect(container.querySelector('strong')?.textContent).toBe('kalın');
    expect(container.querySelector('em')?.textContent).toBe('italik');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('HTML girdisini METİN olarak basıyor, ayrıştırmıyor', () => {
    // API `richText` alanında HTML'i bilerek reddediyor; istemci o kararı
    // sessizce geri almamalı.
    const { container } = render(<Markdown source={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('güvenli olmayan bağlantı şemasını bağlantı YAPMIYOR', () => {
    const { container } = render(<Markdown source={'[tıkla](javascript:alert(1))'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('tıkla');
  });

  it('https bağlantısını rel korumasıyla çiziyor', () => {
    const { container } = render(<Markdown source={'[site](https://ornek.com)'} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://ornek.com');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });
});

describe('hizmet listesi — showPrices', () => {
  const site = (showPrices: boolean): PublicSitePayload =>
    ({
      slug: 'demo',
      name: 'Demo',
      timezone: 'Europe/Istanbul',
      currency: 'TRY',
      locales: ['tr'],
      defaultBranchId: null,
      canonicalUrl: '',
      branches: [],
      theme: {},
      sections: [],
      seo: {},
      settings: {
        minLeadMinutes: 0,
        maxAdvanceDays: 180,
        cancelWindowHours: 24,
        holdTtlMinutes: 10,
        showStaffSelection: true,
        showPrices,
        allowReschedule: true,
        requireOtp: true,
        otpChannel: 'sms',
        consent: null,
      },
      revision: { number: 1, contentHash: 'x' },
    });

  const categories = [
    {
      id: 'c1',
      name: 'Cilt',
      services: [
        {
          id: 's1',
          name: 'Lazer',
          description: null,
          durationMinutes: 30,
          priceMinor: 125_000,
          currency: 'TRY',
        },
      ],
    },
  ];

  it('showPrices açıkken fiyatı gösteriyor', () => {
    render(
      <ServiceList
        block={{ type: 'serviceList' }}
        ctx={{ site: site(true), categories, isFirst: false }}
      />,
    );
    expect(screen.getByText(/1\.250,00/)).toBeInTheDocument();
  });

  it('showPrices kapalıyken fiyat DÜĞÜMÜ hiç yok', () => {
    // "0 TL" yazmamak yetmez; DOM'da fiyat olmamalı.
    const { container } = render(
      <ServiceList
        block={{ type: 'serviceList' }}
        ctx={{ site: site(false), categories, isFirst: false }}
      />,
    );
    expect(container.textContent).not.toContain('1.250');
    expect(container.textContent).not.toContain('TRY');
    expect(container.textContent).not.toContain('₺');
  });
});

describe('hizmet listesi — kategori sekmeleri', () => {
  const baseSite = {
    slug: 'demo',
    name: 'Demo',
    currency: 'TRY',
    branches: [],
    settings: { showPrices: true },
  } as unknown as PublicSitePayload;

  const service = (id: string, name: string) => ({
    id,
    name,
    description: null,
    durationMinutes: 30,
    priceMinor: 10_000,
    currency: 'TRY',
  });

  const categories = [
    { id: 'c1', name: 'Epilasyon', services: [service('s1', 'Bölgesel Lazer'), service('s2', 'Tüm Vücut')] },
    { id: 'c2', name: 'Cilt bakımı', services: [service('s3', 'Hydrafacial')] },
    { id: 'c3', name: 'Boş', services: [] },
  ];

  it('tek kategoride sekme YOK, düz liste', () => {
    render(
      <ServiceList
        block={{ type: 'serviceList' }}
        ctx={{ site: baseSite, categories: categories.slice(0, 1), isFirst: false }}
      />,
    );
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText('Bölgesel Lazer')).toBeInTheDocument();
  });

  it('birden çok kategoride sekmeler; boş kategori sekme olmuyor; paneller DOM\'da', async () => {
    const user = userEvent.setup();
    render(
      <ServiceList
        block={{ type: 'serviceList', title: 'Hizmetlerimiz' }}
        ctx={{ site: baseSite, categories, isFirst: false }}
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Epilasyon2', 'Cilt bakımı1']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    // Seçilmeyen panel gizli ama DOM'da: arama motoru ve JS'siz ziyaretçi görür.
    expect(screen.getByText('Hydrafacial')).not.toBeVisible();

    await user.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Hydrafacial')).toBeVisible();
    expect(screen.getByText('Bölgesel Lazer')).not.toBeVisible();
  });

  it('ok tuşlarıyla sekmeler arasında dolaşılıyor', async () => {
    const user = userEvent.setup();
    render(
      <ServiceList block={{ type: 'serviceList' }} ctx={{ site: baseSite, categories, isFirst: false }} />,
    );
    const tabs = screen.getAllByRole('tab');
    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tabs[0]).toHaveFocus();
  });
});

describe('SSS akordeonu', () => {
  it('yerel <details> ile çiziliyor; cevap metin olarak basılıyor', () => {
    const { container } = render(
      <Faq
        block={{
          type: 'faq',
          title: 'Sık sorulan sorular',
          items: [
            { question: 'İptal?', answer: '24 saat önce.' },
            { question: '  ', answer: 'boş soru atlanır' },
            { question: 'HTML?', answer: '<b>kalın değil</b>' },
          ],
        }}
      />,
    );
    const details = container.querySelectorAll('details');
    expect(details).toHaveLength(2);
    expect(within(details[0] as HTMLElement).getByText('İptal?')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>kalın değil</b>');
  });

  it('sorusu olmayan blok hiç çizilmiyor', () => {
    const { container } = render(<Faq block={{ type: 'faq', items: [] }} />);
    expect(container.innerHTML).toBe('');
  });
});
