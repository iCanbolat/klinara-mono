'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, FileText, Globe, LayoutPanelTop, UserCog, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { visibleNav } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { t, type MessageKey } from '@/i18n/tr';
import { KlinaraMark } from '@/components/brand/klinara-mark';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

/**
 * Rota → ikon eşlemesi BURADA, `lib/permissions.ts`te DEĞİL.
 *
 * `NAV_ITEMS` saf bir izin yapısı ve birim testleri onu öyle sınıyor; oraya bir
 * React ikonu koymak, izin mantığını bir sunum detayına bağımlı kılardı.
 * Eşleşmeyen bir rota olursa ikon çizilmiyor — menü yine de çalışıyor.
 */
const ICONS: Record<string, LucideIcon> = {
  '/sayfa': LayoutPanelTop,
  '/icerik': FileText,
  '/alan-adlari': Globe,
  '/raporlar': BarChart3,
  '/hesap': UserCog,
};

/**
 * İzne göre süzülmüş gezinme.
 *
 * İzni olmayan öge RENDER EDİLMİYOR — `hidden` sınıfıyla gizlenmiyor. Gizlenmiş
 * bir bağlantı DOM'da durur, ekran okuyucuya okunur ve klavyeyle odaklanabilir;
 * kullanıcıya göremediği bir menüyü "tıklanamaz" olarak sunmak, hiç
 * göstermemekten kötüdür.
 */
export function Sidebar(): ReactNode {
  const { permissions, loading } = useSession();
  const pathname = usePathname();

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border px-3">
        <Link href="/" className="flex items-center gap-2.5 overflow-hidden rounded-lg py-1">
          <KlinaraMark size={26} />
          <span className="text-title-m leading-none tracking-[0.28em] text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            KLINARA
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            {loading ? (
              <div className="flex flex-col gap-1.5 p-1" aria-busy="true">
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <SidebarMenu>
                {visibleNav(permissions).map((item) => {
                  const active = pathname === item.path || pathname.startsWith(`${item.path}/`);
                  const Icon = ICONS[item.path];
                  const label = t(item.labelKey as MessageKey);
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton asChild isActive={active} tooltip={label}>
                        <Link href={item.path} aria-current={active ? 'page' : undefined}>
                          {Icon === undefined ? null : <Icon aria-hidden="true" />}
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

    </SidebarRoot>
  );
}

