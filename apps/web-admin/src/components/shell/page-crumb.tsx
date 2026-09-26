'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface PageCrumbState {
  label: string | null;
  setLabel: (label: string | null) => void;
}

const PageCrumbContext = createContext<PageCrumbState | null>(null);

/**
 * Detay sayfasının kırıntı yoluna eklediği son halka ("Müşteriler › Ayşe Yılmaz").
 *
 * Kök halka `NAV_ITEMS`ten türüyor ve rota bilgisiyle yetiniyor; kaydın ADI ise
 * yalnız sayfanın çektiği veride var. Topbar veriyi yeniden çekmesin diye ad
 * sayfadan buraya bildiriliyor.
 */
export function PageCrumbProvider({ children }: { children: ReactNode }): ReactNode {
  const [label, setLabel] = useState<string | null>(null);
  return <PageCrumbContext value={{ label, setLabel }}>{children}</PageCrumbContext>;
}

export function usePageCrumbLabel(): string | null {
  return useContext(PageCrumbContext)?.label ?? null;
}

/**
 * Sayfa ayrılınca halka temizleniyor: temizlenmeseydi bir sonraki sayfanın
 * kırıntısında önceki kaydın adı asılı kalırdı.
 */
export function usePageCrumb(label: string | null): void {
  const setLabel = useContext(PageCrumbContext)?.setLabel;
  useEffect(() => {
    if (setLabel === undefined) return;
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}
