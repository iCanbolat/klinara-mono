import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { SignatureKind, SignerRelation } from '@klinara/shared';

/**
 * İmzalı onamın PDF kopyası.
 *
 * Yazdırılabilir, hastaya verilebilir bir belge; kanıtın KENDİSİ değil. Kanıt
 * `consent_signatures` satırı (metin, hash'ler, imza görseli). PDF'in
 * sha256'sı da o satırda durduğu için sonradan değiştirilmiş bir PDF ayırt
 * edilebilir.
 *
 * Font gömülü (Source Serif 4, OFL — `fonts/OFL-SourceSerif4.txt`): PDF'in
 * standart 14 fontu WinAnsi kodlamasıyla sınırlı ve "ğ, ş, ı, İ" çizemez.
 */

export interface ConsentPdfInput {
  signatureId: string;
  clinicName: string;
  branchName: string | null;
  kind: SignatureKind;
  documentTitle: string;
  documentVersion: number;
  text: string;
  textSha256: string;
  signerName: string;
  signerRelation: SignerRelation;
  guardianOfName: string | null;
  signaturePng: Buffer;
  signatureSha256: string;
  signedAt: Date;
  timeZone: string;
  collectedByName: string | null;
  ip: string | null;
  userAgent: string | null;
}

const PAGE = { width: 595.28, height: 841.89 } as const; // A4
const MARGIN = 56;
const BODY_SIZE = 10.5;
const LINE_HEIGHT = 15;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.85, 0.85, 0.87);

interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
}

let fontBytes: Promise<[Buffer, Buffer]> | undefined;

/**
 * Fontlar süreç başına BİR kez okunur. Başarısız okuma önbellekte KALMAZ:
 * dosya sonradan yerine gelirse (ör. derleme asset'leri geç kopyaladıysa)
 * bir sonraki imza yeniden dener; yoksa sunucu yeniden başlatılana kadar
 * her imza düşerdi.
 */
function loadFontBytes(): Promise<[Buffer, Buffer]> {
  fontBytes ??= Promise.all([
    readFile(join(__dirname, 'fonts', 'SourceSerif4-Regular.ttf')),
    readFile(join(__dirname, 'fonts', 'SourceSerif4-Semibold.ttf')),
  ]).catch((error: unknown) => {
    fontBytes = undefined;
    throw error;
  });
  return fontBytes;
}

export async function renderConsentPdf(input: ConsentPdfInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, semiboldBytes] = await loadFontBytes();
  const fonts: Fonts = {
    regular: await pdf.embedFont(regularBytes, { subset: true }),
    semibold: await pdf.embedFont(semiboldBytes, { subset: true }),
  };

  pdf.setTitle(`${input.documentTitle} — ${input.signerName}`);
  pdf.setAuthor(input.clinicName);
  pdf.setSubject(input.kind === 'kvkk_explicit' ? 'KVKK aydınlatma ve açık rıza' : 'İşlem onamı');
  pdf.setProducer('Klinara');
  pdf.setCreator('Klinara');
  pdf.setCreationDate(input.signedAt);
  pdf.setModificationDate(input.signedAt);

  const writer = new PageWriter(pdf, fonts);

  // --- Başlık ---
  writer.line(input.clinicName, { font: fonts.semibold, size: 13 });
  if (input.branchName !== null) writer.line(input.branchName, { color: MUTED, size: 9.5 });
  writer.gap(14);
  writer.line(input.documentTitle, { font: fonts.semibold, size: 16 });
  writer.line(`Sürüm ${input.documentVersion}`, { color: MUTED, size: 9.5 });
  writer.gap(8);
  writer.rule();
  writer.gap(10);

  // --- Metin ---
  for (const paragraph of input.text.replace(/\r\n?/g, '\n').split('\n')) {
    if (paragraph.trim() === '') {
      writer.gap(LINE_HEIGHT * 0.6);
      continue;
    }
    writer.paragraph(paragraph);
  }

  // --- İmza bloğu ---
  const signature = await pdf.embedPng(input.signaturePng);
  const maxWidth = 220;
  const maxHeight = 90;
  const scale = Math.min(maxWidth / signature.width, maxHeight / signature.height, 1);
  const sigWidth = signature.width * scale;
  const sigHeight = signature.height * scale;

  writer.gap(18);
  writer.ensure(sigHeight + 120);
  writer.rule();
  writer.gap(12);
  writer.line('Onay', { font: fonts.semibold, size: 11 });
  writer.gap(4);
  writer.paragraph(
    'Yukarıdaki metni okudum, anladım. Bu belgeyi kendi özgür irademle imzalıyorum.',
  );
  writer.gap(8);

  const who =
    input.signerRelation === 'guardian' && input.guardianOfName !== null
      ? `${input.signerName} (${input.guardianOfName} adına veli/vasi)`
      : input.signerName;
  writer.field('İmzalayan', who);
  writer.field('Tarih', formatInstant(input.signedAt, input.timeZone));
  writer.gap(6);
  writer.image(signature, sigWidth, sigHeight);

  // --- Kanıt bilgisi ---
  writer.gap(18);
  writer.ensure(110);
  writer.rule();
  writer.gap(8);
  const meta: Array<[string, string]> = [
    ['Kayıt no', input.signatureId],
    ['Onamı alan', input.collectedByName ?? '—'],
    ['Metin SHA-256', input.textSha256],
    ['İmza SHA-256', input.signatureSha256],
    ['IP adresi', input.ip ?? '—'],
    ['Cihaz', truncate(input.userAgent ?? '—', 110)],
  ];
  for (const [label, value] of meta) writer.field(label, value, { size: 8, color: MUTED });

  writer.footer(`${input.clinicName} · ${input.documentTitle} · Kayıt ${input.signatureId}`);
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

function formatInstant(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    dateStyle: 'long',
    timeStyle: 'medium',
  }).format(instant);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Yukarıdan aşağı yazan, sığmayınca yeni sayfa açan basit bir yazıcı.
 *
 * pdf-lib bir düzen motoru değil: satır kırma ve sayfalama burada, font
 * genişlik ölçümüyle yapılıyor.
 */
class PageWriter {
  private page: PDFPage;
  private y: number;
  private readonly pages: PDFPage[] = [];

  constructor(
    private readonly pdf: PDFDocument,
    private readonly fonts: Fonts,
  ) {
    this.page = this.addPage();
    this.y = PAGE.height - MARGIN;
  }

  private addPage(): PDFPage {
    const page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(page);
    return page;
  }

  private get width(): number {
    return PAGE.width - MARGIN * 2;
  }

  /** Kalan alan yetmiyorsa yeni sayfa. */
  ensure(height: number): void {
    if (this.y - height < MARGIN + 20) {
      this.page = this.addPage();
      this.y = PAGE.height - MARGIN;
    }
  }

  gap(height: number): void {
    this.y -= height;
  }

  rule(): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
  }

  line(
    text: string,
    options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ): void {
    const size = options.size ?? BODY_SIZE;
    const font = options.font ?? this.fonts.regular;
    for (const wrapped of wrap(text, font, size, this.width)) {
      this.ensure(size * 1.45);
      this.y -= size * 1.45;
      this.page.drawText(wrapped, {
        x: MARGIN,
        y: this.y,
        size,
        font,
        color: options.color ?? INK,
      });
    }
  }

  paragraph(text: string): void {
    this.line(text);
  }

  field(
    label: string,
    value: string,
    options: { size?: number; color?: ReturnType<typeof rgb> } = {},
  ): void {
    const size = options.size ?? BODY_SIZE;
    const labelWidth = size * 9;
    const lines = wrap(value, this.fonts.regular, size, this.width - labelWidth);
    lines.forEach((wrapped, index) => {
      this.ensure(size * 1.5);
      this.y -= size * 1.5;
      if (index === 0) {
        this.page.drawText(label, {
          x: MARGIN,
          y: this.y,
          size,
          font: this.fonts.semibold,
          color: options.color ?? INK,
        });
      }
      this.page.drawText(wrapped, {
        x: MARGIN + labelWidth,
        y: this.y,
        size,
        font: this.fonts.regular,
        color: options.color ?? INK,
      });
    });
  }

  image(image: Awaited<ReturnType<PDFDocument['embedPng']>>, width: number, height: number): void {
    this.ensure(height + 10);
    this.y -= height;
    this.page.drawImage(image, { x: MARGIN, y: this.y, width, height });
    this.y -= 4;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + Math.max(width, 180), y: this.y },
      thickness: 0.6,
      color: MUTED,
    });
  }

  /** Her sayfanın altına kimlik satırı ve sayfa numarası. */
  footer(text: string): void {
    const size = 7.5;
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const label = truncate(`${text} · Sayfa ${index + 1}/${total}`, 150);
      page.drawText(label, {
        x: MARGIN,
        y: MARGIN / 2,
        size,
        font: this.fonts.regular,
        color: MUTED,
      });
    });
  }
}

/** Kelime sınırından satır kırma; tek kelime satıra sığmıyorsa harf harf böler. */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  const fits = (value: string): boolean => font.widthOfTextAtSize(value, size) <= maxWidth;

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    if (fits(word)) {
      current = word;
      continue;
    }
    // Satırdan uzun tek parça (hash, URL): karakter karakter kır.
    let chunk = '';
    for (const char of word) {
      if (fits(chunk + char)) {
        chunk += char;
      } else {
        lines.push(chunk);
        chunk = char;
      }
    }
    current = chunk;
  }
  if (current !== '') lines.push(current);
  return lines;
}
