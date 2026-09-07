'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Field } from '@/components/ui/field';
import { inputToMinor, minorToInput } from '@/lib/format/money';

/**
 * Para girdisi — dışarıya KURUŞ verir, içeride metin tutar.
 *
 * ---------------------------------------------------------------------------
 * NEDEN İÇERİDE METİN
 * ---------------------------------------------------------------------------
 * Değeri her tuşta sayıya çevirip geri metne dökmek, kullanıcının yazdığını
 * altından çeker: `'12,'` yazan biri anında `'12,00'` görür ve imleç sona
 * atlar. Bu yüzden metin YEREL durumda tutuluyor; dışarıya yalnız
 * ayrıştırılabilir olduğunda kuruş gidiyor.
 *
 * Ayrıştırılamayan girdide `onChange` `null` alıyor — çağıran "kaydet"i
 * kapatabilsin. Sessizce eski değeri korumak, kullanıcının sildiği bir fiyatın
 * kaydedilmesi demekti.
 */
export function MoneyInput({
  label,
  valueMinor,
  disabled,
  error,
  onChange,
}: {
  label: string;
  valueMinor: number | null;
  disabled?: boolean;
  error?: string | undefined;
  onChange: (minor: number | null) => void;
}): ReactNode {
  const [text, setText] = useState(() => (valueMinor === null ? '' : minorToInput(valueMinor)));

  // Dışarıdan gelen değer değişirse (form sıfırlama, başka kayda geçiş)
  // metin de yenilenmeli — ama kullanıcı yazarken DEĞİL, yoksa imleç kaybolur.
  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      setText((current) =>
        inputToMinor(current) === valueMinor ? current : valueMinor === null ? '' : minorToInput(valueMinor),
      );
    })();
  }, [valueMinor]);

  return (
    <Field
      label={label}
      inputMode="decimal"
      value={text}
      disabled={disabled ?? false}
      error={error}
      hint="₺"
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        onChange(inputToMinor(next));
      }}
    />
  );
}
