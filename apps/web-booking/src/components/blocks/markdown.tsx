import type { ReactNode } from 'react';

/**
 * Küçük, izin listeli Markdown renderer'ı.
 *
 * ⚠️ `dangerouslySetInnerHTML` YOK ve olmayacak. API `richText.body` alanında
 * HTML'i BİLEREK reddediyor (`content.dto.ts`): kiracının kendi sayfasına keyfî
 * işaretleme koyabilmesi, kendi alan adımızdan servis edilen bir XSS demekti.
 * İstemcide bir markdown kütüphanesi çağırıp çıktısını HTML olarak basmak, o
 * kararı sessizce geri almak olurdu — bu yüzden burada React elemanı üretiliyor
 * ve metin her zaman metin olarak kalıyor.
 *
 * Desteklenen: `#`–`###` başlık, `-`/`*` liste, `1.` sıralı liste, paragraf,
 * `**kalın**`, `*italik*`, `[metin](https://…)`. Desteklenmeyen her şey düz
 * metin olarak görünür — sessizce kaybolmaz.
 */

const SAFE_LINK = /^https?:\/\//i;

export function Markdown({ source }: { source: string }) {
  return <>{parseBlocks(source)}</>;
}

function parseBlocks(source: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? '';
      const className =
        level === 1
          ? 'mt-8 text-2xl font-semibold'
          : level === 2
            ? 'mt-6 text-xl font-semibold'
            : 'mt-4 text-lg font-semibold';
      out.push(
        level === 1 ? (
          <h2 key={key++} className={className}>
            {inline(text)}
          </h2>
        ) : level === 2 ? (
          <h3 key={key++} className={className}>
            {inline(text)}
          </h3>
        ) : (
          <h4 key={key++} className={className}>
            {inline(text)}
          </h4>
        ),
      );
      index += 1;
      continue;
    }

    const isBullet = (value: string) => /^\s*[-*]\s+/.test(value);
    const isOrdered = (value: string) => /^\s*\d+[.)]\s+/.test(value);

    if (isBullet(line) || isOrdered(line)) {
      const ordered = isOrdered(line);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const matches = ordered ? isOrdered(current) : isBullet(current);
        if (!matches) break;
        items.push(current.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, ''));
        index += 1;
      }
      const listItems = items.map((item, i) => <li key={i}>{inline(item)}</li>);
      out.push(
        ordered ? (
          <ol key={key++} className="mt-3 list-decimal space-y-1 pl-6">
            {listItems}
          </ol>
        ) : (
          <ul key={key++} className="mt-3 list-disc space-y-1 pl-6">
            {listItems}
          </ul>
        ),
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '' || /^#{1,3}\s/.test(current) || isBullet(current) || isOrdered(current)) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    out.push(
      <p key={key++} className="mt-3 leading-relaxed">
        {inline(paragraph.join(' '))}
      </p>,
    );
  }

  return out;
}

/** Satır içi işaretleme — kalın, italik, bağlantı. */
function inline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  const parts = text.split(pattern).filter((part) => part !== '');

  return parts.map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold !== null) return <strong key={i}>{bold[1]}</strong>;

    const italic = /^\*([^*]+)\*$/.exec(part);
    if (italic !== null) return <em key={i}>{italic[1]}</em>;

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link !== null) {
      const href = link[2] ?? '';
      // `javascript:` ve `data:` şemaları burada ölüyor. Bir markdown
      // kütüphanesinin varsayılanına güvenmek yerine açıkça sınırlıyoruz.
      if (!SAFE_LINK.test(href)) return <span key={i}>{link[1]}</span>;
      return (
        <a
          key={i}
          href={href}
          className="underline underline-offset-2"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          {link[1]}
        </a>
      );
    }

    return <span key={i}>{part}</span>;
  });
}
