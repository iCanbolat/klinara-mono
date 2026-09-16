'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface ServiceTab {
  id: string;
  label: string;
  count: number;
  panel: ReactNode;
}

/**
 * Hizmet kategorileri sekmeleri — WAI-ARIA "tabs" deseni, kütüphanesiz.
 *
 * Paneller SUNUCUDA çiziliyor ve HEPSİ DOM'da duruyor; seçilmeyenler `hidden`.
 * Arama motoru ve JS'siz ziyaretçi hizmetlerin tamamını görüyor, bu ada yalnız
 * hangisinin gösterileceğini seçiyor. Ok tuşları sekmeler arasında dolaşıyor
 * (roving tabindex), Home/End uçlara gidiyor.
 */
export function ServiceTabs({ tabs, label }: { tabs: readonly ServiceTab[]; label: string }) {
  const baseId = useId();
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(index: number): void {
    const next = (index + tabs.length) % tabs.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusTab(target);
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {tabs.map((tab, index) => {
          const selected = index === active;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${String(index)}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${String(index)}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                selected
                  ? 'border-brand bg-brand text-white shadow-sm'
                  : 'border-line-strong bg-card text-ink hover:border-brand hover:text-brand'
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  selected ? 'bg-white/20 text-white' : 'bg-brand-soft text-brand-ink'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${String(index)}`}
          aria-labelledby={`${baseId}-tab-${String(index)}`}
          hidden={index !== active}
          className="mt-6"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
