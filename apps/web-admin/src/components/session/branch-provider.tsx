'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Branch } from '@klinara/shared';
import { api, SessionExpiredError } from '@/lib/api/client';
import { useSession } from './session-provider';

/**
 * Seçili şube — panelin İLK şube kapsamı.
 *
 * Faz 11 boyunca gerek olmamıştı: randevu sayfası kiracı geneli bir kaynak ve
 * içerik editörü şube sormuyor. Raporlar bunu değiştiriyor.
 *
 * `localStorage`, `sessionStorage` DEĞİL: şube tercihi bir taslak değil bir
 * çalışma bağlamı; kullanıcı yarın paneli açtığında dün baktığı şubede olmak
 * ister. (İçerik editörünün taslağı tersine `sessionStorage`ta duruyor —
 * haftalar sonra ölü bir taslağı diriltmemek için.)
 *
 * ⚠️ Bu bir YETKİ KAPISI DEĞİL. Şube üyeliğini sunucudaki
 * `BranchAccessService.assertInput` doğruluyor; buradaki liste yalnız
 * kullanıcıya erişemeyeceği bir şubeyi seçtirmemek için.
 */

const STORAGE_KEY = 'klinara.admin.branchId';

interface BranchState {
  branches: Branch[];
  /** `null` = tüm şubeler; yalnız kiracı geneli rollerde seçilebilir. */
  branchId: string | null;
  setBranchId: (branchId: string | null) => void;
  /** Kiracı geneli bir rol mü — "Tüm şubeler" seçeneği buna bağlı. */
  canSelectAll: boolean;
  loading: boolean;
}

const BranchContext = createContext<BranchState | null>(null);

export function useBranch(): BranchState {
  const value = useContext(BranchContext);
  if (value === null) throw new Error('useBranch yalnız BranchProvider içinde kullanılabilir.');
  return value;
}

export function BranchProvider({ children }: { children: ReactNode }): ReactNode {
  const { me, loading: sessionLoading } = useSession();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchId, setBranchIdState] = useState<string | null>(null);

  const canSelectAll = me?.tenantWide ?? false;

  const setBranchId = useCallback((next: string | null) => {
    setBranchIdState(next);
    try {
      if (next === null) globalThis.localStorage?.removeItem(STORAGE_KEY);
      else globalThis.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      // Gizli sekmede ya da depolama kapalıyken yazma fırlıyor. Tercihin
      // kalıcı olmaması bir kolaylık kaybı; seçimin ÇALIŞMAMASI ise bir hata
      // olurdu, o yüzden yutuluyor.
    }
  }, []);

  useEffect(() => {
    if (sessionLoading || me === null) return;
    void (async () => {
      try {
        // `GET branches` yanıtı ZARFLI: `{ data: [...] }`. Düz dizi bekleyip
        // gelen nesneyi state'e koymak, süzgeçteki `branches.map`i çalışma
        // anında patlatıyordu — sözleşme API tarafında, uyacak taraf burası.
        const { data: list } = await api.get<{ data: Branch[] }>('branches');
        setBranches(list);

        const stored = readStored();
        // Saklanan şube hâlâ erişilebilir mi? Rolü değişmiş bir kullanıcının
        // eski seçimiyle 403 yemesi, "rapor bozuk" diye okunurdu.
        const usable = stored !== null && list.some((branch) => branch.id === stored);
        if (usable) setBranchIdState(stored);
        else if (!canSelectAll) setBranchIdState(list[0]?.id ?? null);
        else setBranchIdState(null);
      } catch (caught) {
        if (caught instanceof SessionExpiredError) return;
        // Şube listesi alınamadıysa rapor yine de çalışır: sunucu şube
        // verilmediğinde kullanıcının erişebildiği şubelere daraltıyor.
        setBranches([]);
      }
    })();
  }, [sessionLoading, me, canSelectAll]);

  const value = useMemo<BranchState>(
    () => ({
      branches: branches ?? [],
      branchId,
      setBranchId,
      canSelectAll,
      loading: branches === null,
    }),
    [branches, branchId, setBranchId, canSelectAll],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}
