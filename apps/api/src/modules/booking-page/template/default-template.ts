import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentBlockInput, SeoInput, ThemeInput } from '@klinara/shared';

/**
 * Yeni kliniğin randevu sayfası için HAZIR ŞABLON.
 *
 * Boş bir editörle karşılaşan klinik "nereden başlayacağım?" sorusunda takılıyor;
 * şablon, her blok türünün doldurulmuş bir örneğini ve gerçek görselleri
 * getiriyor. Klinik metinleri kendi bilgisiyle değiştirip yayınlıyor.
 *
 * TEK KAYNAK: hem `BookingSiteProvisioner` (yeni klinik) hem geliştirme seed'i
 * bu dosyayı okuyor; demo klinikte görülen sayfa, müşterinin ilk gördüğü
 * sayfanın ta kendisi.
 *
 * Şablon TASLAK olarak yazılıyor, yayınlanmıyor: yayın onam metni ister ve
 * kliniğin kendi adına konuşmayan bir metni internete çıkarmak doğru olmaz.
 */

export type TemplateImageKey = 'hero' | 'skinCare' | 'laser' | 'consultation' | 'treatmentRoom';

export interface TemplateImage {
  key: TemplateImageKey;
  file: string;
  purpose: 'booking_hero' | 'booking_gallery';
  alt: string;
  width: number;
  height: number;
}

/** Kaynak ve lisans: `assets/README.md`. */
export const TEMPLATE_IMAGES: readonly TemplateImage[] = [
  { key: 'hero', file: 'hero-salon.webp', purpose: 'booking_hero', alt: 'Aydınlık, bitkili klinik bekleme salonu', width: 1600, height: 1067 },
  { key: 'skinCare', file: 'cilt-bakimi.webp', purpose: 'booking_gallery', alt: 'Cihazla yüz bakımı uygulaması', width: 1600, height: 1067 },
  { key: 'laser', file: 'lazer-epilasyon.webp', purpose: 'booking_gallery', alt: 'Koruyucu gözlükle lazer epilasyon seansı', width: 1600, height: 1067 },
  { key: 'consultation', file: 'konsultasyon.webp', purpose: 'booking_gallery', alt: 'Uzmanla ön görüşme', width: 1600, height: 1067 },
  { key: 'treatmentRoom', file: 'uygulama-odasi.webp', purpose: 'booking_gallery', alt: 'Uygulama odası', width: 1600, height: 1064 },
];

export type TemplateImageIds = Partial<Record<TemplateImageKey, string>>;

export function readTemplateImage(image: TemplateImage): Promise<Buffer> {
  return readFile(join(__dirname, 'assets', image.file));
}

export interface TemplateDocument {
  theme: ThemeInput;
  sections: ContentBlockInput[];
  seo: SeoInput;
}

/**
 * Şablon dokümanı. Görseli yüklenemeyen alanlar (depolama erişilemedi)
 * atlanıyor; doküman her durumda sunucu doğrulamasından geçer.
 */
export function buildDefaultTemplate(clinicName: string, images: TemplateImageIds): TemplateDocument {
  const gallery = (
    [
      ['skinCare', 'Cilt bakımı', 'Kişiye özel cilt bakım protokolleri'],
      ['laser', 'Lazer epilasyon', 'Son nesil lazer teknolojisi'],
      ['consultation', 'Ön görüşme', 'Her uygulama öncesi uzman değerlendirmesi'],
      ['treatmentRoom', 'Uygulama odası', 'Sessiz, steril ve konforlu odalar'],
    ] as const
  ).flatMap(([key, alt, caption]) => {
    const assetId = images[key];
    return assetId === undefined ? [] : [{ assetId, alt, caption }];
  });

  const name = clinicName.trim() === '' ? 'Kliniğimiz' : clinicName.trim();

  const sections: ContentBlockInput[] = [
    {
      type: 'hero',
      title: name.slice(0, 120),
      subtitle: 'Uzman kadromuzla cilt ve lazer bakımı. Online randevu birkaç adımda.',
      ctaLabel: 'Hemen randevu al',
      ...(images.hero === undefined ? {} : { imageAssetId: images.hero }),
    },
    {
      type: 'richText',
      title: 'Hakkımızda',
      body:
        'Kliniğimizde **medikal estetik** ve cilt bakımı alanında deneyimli bir ekiple hizmet veriyoruz.\n\n' +
        '- Sertifikalı uygulayıcılar\n- Tek kullanımlık ve steril ekipman\n- Her uygulama öncesi ücretsiz ön görüşme',
    },
    ...(gallery.length === 0
      ? []
      : [{ type: 'carousel' as const, title: 'Kliniğimizden', items: gallery }]),
    { type: 'serviceList', title: 'Hizmetlerimiz' },
    {
      type: 'faq',
      title: 'Sık sorulan sorular',
      items: [
        {
          question: 'Randevumu nasıl iptal ederim?',
          answer: 'Onay mesajındaki bağlantıdan, randevudan 24 saat öncesine kadar iptal edebilir ya da saatini değiştirebilirsiniz.',
        },
        {
          question: 'Lazer epilasyon öncesi nelere dikkat etmeliyim?',
          answer: 'Uygulamadan 2 hafta önce güneşlenmeyin, bölgeyi ağda ya da cımbızla almayın. Uygulama günü tıraş olmanız yeterli.',
        },
        {
          question: 'İlk görüşme ücretli mi?',
          answer: 'Hayır. Her uygulama öncesi uzmanlarımız ücretsiz ön değerlendirme yapar.',
        },
        {
          question: 'Ödeme nasıl yapılıyor?',
          answer: 'Ödeme klinikte, hizmet sonrasında nakit ya da kartla alınır.',
        },
      ],
    },
    { type: 'contact', title: 'Şubelerimiz', showPhones: true, showAddresses: true },
    { type: 'map', zoom: 14 },
  ];

  return {
    theme: {
      primaryColor: '#0F766E',
      backgroundColor: '#FAF9F7',
      textColor: '#1C1917',
      fontFamily: 'inter',
      radius: 'lg',
    },
    sections,
    seo: {
      title: `${name} — Online Randevu`.slice(0, 70),
      description: 'Cilt bakımı ve lazer uygulamaları için online randevu alın.',
      ...(images.hero === undefined ? {} : { ogImageAssetId: images.hero }),
    },
  };
}
