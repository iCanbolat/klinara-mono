'use client';

import { Phone } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Telefon girişi — sabit `+90` öneki ve `5XX XXX XX XX` maskesi.
 *
 * Ülke kodu SABİT: sunucudaki `normalizePhone` zaten `DEFAULT_COUNTRY = 'TR'`
 * ile çalışıyor ve arayüz tek dilli (tr). Maske, kullanıcının `0532`, `532`,
 * `+90 532` ve `905321234567` biçimlerinin hepsini yazabilmesi için giriş
 * anında UYGULANIYOR; sunucuya giden değer her hâlükârda `+90` + 10 hane.
 */

const NATIONAL_LENGTH = 10;

/** Kullanıcının yazdığı her şeyden 10 haneli ulusal numarayı çıkarır. */
export function toNationalDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0090')) digits = digits.slice(4);
  if (digits.startsWith('90') && digits.length > NATIONAL_LENGTH) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, NATIONAL_LENGTH);
}

/** `5321234567` → `532 123 45 67` */
export function formatNational(digits: string): string {
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)];
  return parts.filter((part) => part !== '').join(' ');
}

/** Sunucuya gidecek biçim. Eksik numarada boş dize — çağıran gönderemesin. */
export function toE164(digits: string): string {
  return digits.length === NATIONAL_LENGTH ? `+90${digits}` : '';
}

export function isCompletePhone(digits: string): boolean {
  return digits.length === NATIONAL_LENGTH;
}

export function PhoneInput({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  /** Ulusal haneler (maskesiz), örn. `5321234567`. */
  value: string;
  onChange: (digits: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-stretch overflow-hidden border border-line-strong bg-card',
        'transition-[border-color,box-shadow] duration-(--dur-fast)',
        'focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-ring',
        disabled && 'opacity-60',
      )}
      style={{ borderRadius: 'var(--brand-radius)' }}
    >
      <span
        aria-hidden
        className="flex items-center gap-2 border-r border-line px-3 text-base font-medium opacity-70"
      >
        <Phone className="size-4" />
        +90
      </span>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="532 123 45 67"
        disabled={disabled}
        value={formatNational(value)}
        onChange={(event) => {
          onChange(toNationalDigits(event.target.value));
        }}
        className="h-11 w-full min-w-0 bg-transparent px-3 text-base tracking-wide outline-none placeholder:opacity-40"
      />
    </div>
  );
}
