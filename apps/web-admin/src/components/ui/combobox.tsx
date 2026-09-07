'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';

/**
 * Sunucu tarafında arayan seçim kutusu.
 *
 * ---------------------------------------------------------------------------
 * NEDEN `cmdk` DEĞİL
 * ---------------------------------------------------------------------------
 * `cmdk` (ve üstündeki shadcn `Command`) kendi FİLTRELEME modelini getiriyor:
 * seçenekler istemcide tutulur ve yazdıkça yerelde süzülür. Buradaki
 * filtreleme SUNUCUDA (`GET /customers/search?q=`, `q` en az 2 karakter,
 * sayfalama yok). Kütüphanenin modeliyle bizimki ters; kullanmak için
 * filtrelemesini devre dışı bırakıp yalnız klavye gezinmesini almak
 * gerekirdi — o da zaten burada yazılı olan kısım.
 *
 * Radix `Popover` de kullanılmadı: popover içindeki bir `Input`a odağı
 * korumak Radix'in odak tuzağıyla kavga etmek demek. Liste, girdinin hemen
 * altında konumlanan basit bir `absolute` katman.
 *
 * ---------------------------------------------------------------------------
 * ERİŞİLEBİLİRLİK
 * ---------------------------------------------------------------------------
 * ARIA 1.2 combobox deseni: `role="combobox"` girdide, `aria-expanded`,
 * `aria-controls`, `aria-activedescendant`. Odak GİRDİDE kalıyor, listeye
 * gitmiyor — ekran okuyucu etkin seçeneği `aria-activedescendant` üzerinden
 * duyuruyor. Klavye: ↑/↓ gezinme, Enter seçim, Esc kapatma.
 */

export interface ComboboxOption {
  id: string;
  label: string;
  /** İkinci satır — telefon, kategori adı, e-posta. */
  hint?: string;
}

export interface ComboboxProps {
  label: string;
  /** Seçili kaydın gösterilecek hâli; `null` = seçim yok. */
  value: ComboboxOption | null;
  onSelect: (option: ComboboxOption | null) => void;
  /**
   * Arama. `signal` ile iptal edilebilir olmalı — kullanıcı hızlı yazarken
   * eski isteklerin sonucu yenisinin üstüne düşerse liste titrer.
   */
  search: (query: string, signal: AbortSignal) => Promise<ComboboxOption[]>;
  /** Sunucunun istediği asgari uzunluk. `GET /customers/search` 2 istiyor. */
  minQueryLength?: number;
  placeholder?: string;
  hint?: string;
  error?: string | undefined;
  disabled?: boolean;
  /** Seçim boşaltılabilir mi. */
  clearable?: boolean;
  /** Sonuç yokken gösterilecek ek eylem (ör. "yeni müşteri ekle"). */
  emptyAction?: ReactNode;
}

const DEBOUNCE_MS = 250;

export function Combobox({
  label,
  value,
  onSelect,
  search,
  minQueryLength = 2,
  placeholder,
  hint,
  error,
  disabled = false,
  clearable = true,
  emptyAction,
}: ComboboxProps): ReactNode {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);

  // Arama: debounce + iptal. `void (async () => …)()` kalıbı zorunlu —
  // `react-hooks/set-state-in-effect` effect gövdesinde senkron `setState`e
  // izin vermiyor (bkz. `use-report.ts`).
  useEffect(() => {
    if (!open) return;
    if (query.trim().length < minQueryLength) {
      void (async () => {
        await Promise.resolve();
        setOptions([]);
        setSearched(false);
        setLoading(false);
      })();
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const result = await search(query.trim(), controller.signal);
          if (controller.signal.aborted) return;
          setOptions(result);
          setActive(0);
          setSearched(true);
        } catch {
          if (controller.signal.aborted) return;
          // Arama hatası sessiz: kullanıcı yazmaya devam ediyor ve her tuşta
          // kırmızı bir satır basmak gürültü olurdu. Boş liste + "sonuç yok"
          // yeterli sinyal.
          setOptions([]);
          setSearched(true);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, minQueryLength, search]);

  // Dışarı tıklayınca kapan. Odak kaybına (`blur`) bağlamak yanlış olurdu:
  // listeye tıklamak da blur üretir ve seçim hiç gerçekleşmezdi.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node) !== true) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function choose(option: ComboboxOption): void {
    onSelect(option);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (options.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + delta + options.length) % options.length);
      return;
    }
    if (event.key === 'Enter' && open) {
      const option = options[active];
      if (option !== undefined) {
        event.preventDefault();
        choose(option);
      }
    }
  }

  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((id): id is string => id !== null)
    .join(' ');

  const tooShort = open && query.trim().length > 0 && query.trim().length < minQueryLength;
  const showEmpty = open && searched && !loading && options.length === 0;

  return (
    <div className="flex flex-col gap-1.5" ref={rootRef}>
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>

      {value !== null ? (
        // Seçim yapıldığında arama girdisi yerine seçili kaydı gösteriyoruz.
        // Girdiyi seçili metinle doldurmak yaygın ama kötü: kullanıcı yazmaya
        // başladığında seçimin hâlâ geçerli olup olmadığı belirsizleşir.
        <div
          className={cn(
            'flex h-11 items-center justify-between gap-2 rounded-lg border border-input px-3',
            disabled && 'opacity-50',
          )}
        >
          <span className="truncate text-sm">
            {value.label}
            {value.hint === undefined ? null : (
              <span className="ml-2 text-muted-foreground">{value.hint}</span>
            )}
          </span>
          {clearable && !disabled ? (
            <button
              type="button"
              className="shrink-0 text-sm text-muted-foreground underline transition-colors hover:text-foreground"
              onClick={() => {
                onSelect(null);
                setQuery('');
              }}
            >
              Değiştir
            </button>
          ) : null}
        </div>
      ) : (
        <div className="relative">
          <Input
            id={inputId}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && options[active] !== undefined ? `${listId}-${String(active)}` : undefined
            }
            aria-describedby={describedBy === '' ? undefined : describedBy}
            aria-invalid={error !== undefined}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />

          {open ? (
            <div className="absolute z-50 mt-1 w-full rounded-lg border border-input bg-card">
              <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
                {options.map((option, index) => (
                  <li
                    key={option.id}
                    id={`${listId}-${String(index)}`}
                    role="option"
                    aria-selected={index === active}
                    className={cn(
                      'cursor-pointer px-3 py-2 text-sm transition-colors',
                      index === active && 'bg-accent',
                    )}
                    // `mousedown` kullanılıyor, `click` değil: `click` blur'dan
                    // SONRA gelir ve liste o arada kapanmış olurdu.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(option);
                    }}
                    onMouseEnter={() => setActive(index)}
                  >
                    <span className="block truncate">{option.label}</span>
                    {option.hint === undefined ? null : (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {loading ? <p className="px-3 py-2 text-sm text-muted-foreground">Aranıyor…</p> : null}

              {tooShort ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  Aramak için en az {minQueryLength} karakter yazın.
                </p>
              ) : null}

              {showEmpty ? (
                <div className="px-3 py-2">
                  <p className="text-sm text-muted-foreground">Sonuç bulunamadı.</p>
                  {emptyAction}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
