'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Seçim kartı — şube, hizmet ve uygulayıcı adımlarının ortak omurgası.
 *
 * Eskiden bu seçimler tam genişlikte `<Button>`lardı ve GRUP SEMANTİĞİ yoktu:
 * ekran okuyucu "3 seçenekten 2.si" diyemiyor, çoklu seçilen hizmetlerde
 * `aria-pressed` bile bulunmuyordu. Radix'in `RadioGroup`/`Checkbox`
 * primitifleri hem doğru rolleri hem de ok tuşlarıyla dolaşmayı ücretsiz
 * veriyor — ikisi de zaten bağımlılıkta, `react-radio-group` bugüne dek hiç
 * kullanılmamıştı.
 */

const CARD =
  'group relative flex w-full items-start gap-3 border p-4 text-left transition-[background,border-color,box-shadow,transform] duration-(--dur-fast) ease-(--ease-out) ' +
  'data-[state=unchecked]:border-line data-[state=unchecked]:bg-card ' +
  'data-[state=checked]:border-brand data-[state=checked]:bg-brand-soft data-[state=checked]:ring-2 data-[state=checked]:ring-brand-ring ' +
  'hover:-translate-y-px hover:shadow-lift disabled:pointer-events-none disabled:opacity-50';

const RADIUS = { borderRadius: 'var(--brand-radius)' } as const;

export interface OptionContent {
  /** Sol taraftaki ikon ya da monogram. */
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Sağ üstteki rozet: süre, fiyat, mesafe… */
  meta?: ReactNode;
}

function Body({ leading, title, description, meta, multiple }: OptionContent & { multiple: boolean }) {
  return (
    <>
      {leading !== undefined && <span className="mt-0.5 shrink-0">{leading}</span>}

      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        {description !== undefined && description !== null && description !== '' && (
          <span className="mt-0.5 block text-sm leading-snug opacity-65">{description}</span>
        )}
      </span>

      {/* Meta ve işaret AYNI SATIRDA: alt alta dizildiklerinde açıklaması
          olmayan kısa kartlarda işaret boşlukta asılı kalıyordu. */}
      <span className="flex shrink-0 items-start gap-3">
        {meta !== undefined && (
          <span className="text-right text-sm font-medium whitespace-nowrap opacity-80">
            {meta}
          </span>
        )}
        <Indicator multiple={multiple} />
      </span>
    </>
  );
}

/** Seçim işareti. Yuvarlak = tek seçim, kare = çoklu seçim. */
function Indicator({ multiple }: { multiple: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-5 items-center justify-center border transition-colors duration-(--dur-fast)',
        'border-line-strong group-data-[state=checked]:border-brand group-data-[state=checked]:bg-brand',
        multiple ? 'rounded-[6px]' : 'rounded-full',
      )}
    >
      <Check className="size-3.5 animate-check-pop text-white opacity-0 group-data-[state=checked]:opacity-100" />
    </span>
  );
}

export function OptionGroup({
  label,
  value,
  onValueChange,
  className,
  children,
}: {
  label: string;
  value: string | null;
  onValueChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      // Radix `value={null}` kabul etmiyor; "hiç seçilmemiş" boş dize.
      value={value ?? ''}
      onValueChange={onValueChange}
      className={cn('grid gap-3', className)}
    >
      {children}
    </RadioGroupPrimitive.Root>
  );
}

export function RadioOption({
  value,
  index = 0,
  disabled,
  ...content
}: OptionContent & { value: string; index?: number; disabled?: boolean }) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      disabled={disabled ?? false}
      className={cn(CARD, 'animate-rise-in')}
      style={{ ...RADIUS, ...staggerStyle(index) }}
    >
      <Body {...content} multiple={false} />
    </RadioGroupPrimitive.Item>
  );
}

export function CheckboxOption({
  checked,
  onCheckedChange,
  index = 0,
  invalid = false,
  disabled,
  ...content
}: OptionContent & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  index?: number;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(next) => {
        onCheckedChange(next === true);
      }}
      disabled={disabled ?? false}
      aria-invalid={invalid || undefined}
      className={cn(
        CARD,
        'animate-rise-in',
        invalid && 'animate-shake !border-red-500 ring-2 ring-red-200',
      )}
      style={{ ...RADIUS, ...staggerStyle(index) }}
    >
      <Body {...content} multiple />
    </CheckboxPrimitive.Root>
  );
}

/**
 * Liste ögelerinin sıralı girişi.
 *
 * Gecikme İNDEKSTEN türüyor ama 8 ögede tavanlanıyor: uzun bir katalogda
 * son kart yarım saniye sonra belirseydi, animasyon süsleme olmaktan çıkıp
 * beklemeye dönüşürdü.
 */
export function staggerStyle(index: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(index, 8) * 35}ms` };
}

/** Fotoğrafı olmayan uygulayıcı için baş harf rozeti. */
export function Monogram({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      aria-hidden
      className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-ink"
    >
      {initials === '' ? '?' : initials}
    </span>
  );
}
