'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { useSession } from '@/components/session/session-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BranchesTab } from '@/components/branches/branches-tab';
import { InvitationsTab } from './invitations-tab';
import { StaffListTab } from './staff-list-tab';

/**
 * "Şube ve Personel".
 *
 * Üç sekme, üçü de kendi iznine bağlı:
 *   - **Personel** (`staff:read`, sayfanın kapısı): liste, şube süzgeci,
 *     profil + rol/şube düzenleme, yetkinlik matrisi.
 *   - **Şubeler** (`branch:read`; ekleme/düzenleme `branch:write`).
 *   - **Davetler** (`user:invite`).
 *
 * Seçili sekme `?tab=` ile adreste duruyor: "Şubeler sekmesine bak" diye
 * paylaşılan bir bağlantı doğru yere açılmalı. `useRouter`/`useSearchParams`
 * yerine `history.replaceState`: sekme değişimi bir gezinme değil, geri tuşu
 * sekmeler arasında dolaşmamalı.
 */

const TABS = ['staff', 'branches', 'invites'] as const;
type StaffTab = (typeof TABS)[number];

function readTab(): StaffTab {
  try {
    const value = new URLSearchParams(globalThis.location?.search ?? '').get('tab');
    return (TABS as readonly string[]).includes(value ?? '') ? (value as StaffTab) : 'staff';
  } catch {
    return 'staff';
  }
}

export function StaffPage(): ReactNode {
  const { permissions } = useSession();
  const canBranches = permissions.includes(PERMISSIONS.BRANCH_READ);
  const canInvite = permissions.includes(PERMISSIONS.USER_INVITE);

  const [tab, setTab] = useState<StaffTab>('staff');
  useEffect(() => {
    // İlk render sunucuyla aynı olmalı; adresteki sekme mount sonrası okunuyor.
    void (async () => {
      await Promise.resolve();
      const initial = readTab();
      if (initial !== 'staff') setTab(initial);
    })();
  }, []);

  const allowed: Record<StaffTab, boolean> = {
    staff: true,
    branches: canBranches,
    invites: canInvite,
  };
  const current = allowed[tab] ? tab : 'staff';

  function changeTab(next: string): void {
    const value = next as StaffTab;
    setTab(value);
    try {
      const url = new URL(globalThis.location.href);
      if (value === 'staff') url.searchParams.delete('tab');
      else url.searchParams.set('tab', value);
      globalThis.history.replaceState(globalThis.history.state, '', url);
    } catch {
      // Adres güncellenemiyorsa sekme yine değişiyor; kaybolan yalnız paylaşım.
    }
  }

  const showTabs = canBranches || canInvite;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('staff.pageTitle')}
        description={t('staff.pageDescription')}
        className="mb-0"
      />

      {showTabs ? (
        <Tabs value={current} onValueChange={changeTab} className="gap-5">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList className="h-10">
              <TabsTrigger value="staff" className="px-3">
                {t('staff.tabStaff')}
              </TabsTrigger>
              {canBranches ? (
                <TabsTrigger value="branches" className="px-3">
                  {t('staff.tabBranches')}
                </TabsTrigger>
              ) : null}
              {canInvite ? (
                <TabsTrigger value="invites" className="px-3">
                  {t('staff.tabInvites')}
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>

          <TabsContent value="staff">
            <StaffListTab />
          </TabsContent>
          {canBranches ? (
            <TabsContent value="branches">
              <BranchesTab />
            </TabsContent>
          ) : null}
          {canInvite ? (
            <TabsContent value="invites">
              <InvitationsTab />
            </TabsContent>
          ) : null}
        </Tabs>
      ) : (
        <StaffListTab />
      )}
    </div>
  );
}
