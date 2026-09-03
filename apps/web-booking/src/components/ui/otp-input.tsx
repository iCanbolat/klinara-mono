'use client';

import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/tr';

/**
 * Segment biçiminde doğrulama kodu girişi.
 *
 * Tek bir metin kutusu yerine altı kutu: sunucu `generateNumericCode(6)`
 * üretiyor ve kullanıcı kodu SMS'ten okuyarak giriyor — hane hane ilerleyen
 * bir alan, yanlış haneyi bulmayı da düzeltmeyi de kolaylaştırıyor.
 *
 * Dışarıya YİNE tek bir dize veriyor: `booking-flow`daki `otpCode` state'i ve
 * `verifyOtp` gövdesi bu bileşenden habersiz.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  function focusBox(index: number): void {
    boxes.current[Math.max(0, Math.min(index, length - 1))]?.focus();
  }

  /**
   * Tek hane de, yapıştırılan/otomatik doldurulan altı hane de AYNI yoldan
   * geçiyor: `autocomplete="one-time-code"` ile gelen dolgu `maxLength=1` bir
   * kutuya tek karakter değil tüm kodu yazar ve bunu ayrı ele almak, iOS'ta
   * çalışıp Android'de çalışmayan bir alan üretirdi.
   */
  function insertAt(index: number, chunk: string): void {
    const digits = chunk.replace(/\D/g, '');
    if (digits === '') return;

    const chars = value.split('');
    for (let offset = 0; offset < digits.length && index + offset < length; offset += 1) {
      chars[index + offset] = digits[offset] ?? '';
    }
    const next = chars.join('').replace(/\D/g, '').slice(0, length);
    onChange(next);
    focusBox(index + digits.length);
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Backspace') {
      event.preventDefault();
      // Boş kutuda backspace ÖNCEKİ haneyi siler: aksi hâlde kullanıcı
      // silmek için önce sola gitmek zorunda kalır.
      const target = value[index] === undefined || value[index] === '' ? index - 1 : index;
      if (target < 0) return;
      const chars = value.split('');
      chars.splice(target, 1);
      onChange(chars.join(''));
      focusBox(target);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  return (
    <div className="flex gap-2" role="group" aria-label={t('booking.otp.label')}>
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            boxes.current[index] = node;
          }}
          value={value[index] ?? ''}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="one-time-code"
          // `maxLength` YOK: otomatik dolgu tüm kodu tek kutuya yazdığında
          // tarayıcı onu kırpmasın, `insertAt` dağıtsın.
          aria-label={t('booking.otp.digit', { index: index + 1 })}
          className={cn(
            'h-14 w-full min-w-0 border border-line-strong bg-card text-center text-xl font-semibold outline-none',
            'transition-[border-color,box-shadow] duration-(--dur-fast)',
            'focus:border-brand focus:ring-2 focus:ring-brand-ring disabled:opacity-60',
          )}
          style={{ borderRadius: 'var(--brand-radius)' }}
          onChange={(event) => {
            insertAt(index, event.target.value);
          }}
          onKeyDown={(event) => {
            handleKeyDown(index, event);
          }}
          onFocus={(event) => {
            event.target.select();
          }}
        />
      ))}
    </div>
  );
}
