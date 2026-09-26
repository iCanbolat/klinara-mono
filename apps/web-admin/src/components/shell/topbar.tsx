'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { LogOut, Shield, UserCog } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useSession } from '@/components/session/session-provider';
import { NAV_ITEMS } from '@/lib/permissions';
import { t, type MessageKey } from '@/i18n/tr';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { NotificationBell } from './notification-bell';
import { usePageCrumbLabel } from './page-crumb';

/** Ad-soyaddan en çok iki baş harf; boşsa e-postanın ilk harfi. */
function initials(fullName: string, email: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '');
  if (parts.length === 0) return (email[0] ?? '?').toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Kırıntı yolu, `NAV_ITEMS`in en uzun eşleşen önekinden türetiliyor —
 * `canOpenPath` ile AYNI kural, böylece menüde görünen ad ile başlıkta görünen
 * ad ayrışamıyor. Alt sayfanın adı (ör. müşteri adı) rotada yok; sayfa onu
 * `usePageCrumb` ile bildirirse kök ögenin ardına son halka olarak ekleniyor.
 */
function trailOf(pathname: string, pageLabel: string | null): { path: string; label: string }[] {
  const match = [...NAV_ITEMS]
    .filter((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (match === undefined) return [];
  const root = { path: match.path, label: t(match.labelKey as MessageKey) };
  // Ad yalnız kökün ALTINDAKİ bir sayfada anlamlı; kökte bırakılmış bir ad
  // (temizleme henüz koşmadıysa) liste sayfasına sızmasın.
  if (pageLabel === null || pathname === match.path) return [root];
  return [root, { path: pathname, label: pageLabel }];
}

export function Topbar(): ReactNode {
  const { me, loading } = useSession();
  const pathname = usePathname();
  const trail = trailOf(pathname, usePageCrumbLabel());
  const deep = trail.length > 1;

  async function logout(): Promise<void> {
    await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/giris';
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6">
      <SidebarTrigger aria-label={t('shell.toggleSidebar')} />
      <Separator orientation="vertical" className="h-6" />

      <Breadcrumb aria-label={t('shell.breadcrumb')} className="min-w-0">
        {/* Tek satır: dar ekranda kök "Klinara Yönetim" düşüyor, son halka
            (kayıt adı) kısalıyor; iki satıra kırılan kırıntı topbar'ı taşırıyordu. */}
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className={deep ? 'hidden md:inline-flex' : undefined}>
            {trail.length === 0 ? (
              <BreadcrumbPage>{t('app.title')}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <Link href="/dashboard">{t('app.title')}</Link>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
          {trail.map((step, index) => (
            <Fragment key={step.path}>
              <BreadcrumbSeparator
                className={deep && index === 0 ? 'hidden md:inline-flex' : undefined}
              />
              <BreadcrumbItem className="min-w-0">
                {index === trail.length - 1 ? (
                  <BreadcrumbPage className="max-w-48 truncate sm:max-w-72">
                    {step.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild className="whitespace-nowrap">
                    <Link href={step.path}>{step.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1">
        {loading || me === null ? null : <NotificationBell />}
        {loading ? (
          <Skeleton className="size-9 rounded-full" />
        ) : me === null ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('shell.userMenu')}
              className="flex items-center gap-2 rounded-lg p-1 hover:bg-muted"
            >
              <Avatar className="size-9">
                <AvatarFallback className="bg-accent text-accent-foreground text-xs font-semibold">
                  {initials(me.user.fullName, me.user.email)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-45 truncate text-sm text-muted-foreground sm:inline">
                {me.user.email}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-body-emphasis">{me.user.fullName}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {me.user.email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/hesap">
                  <UserCog aria-hidden="true" />
                  {t('nav.account')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/hesap/guvenlik">
                  <Shield aria-hidden="true" />
                  {t('shell.security')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                <LogOut aria-hidden="true" />
                {t('nav.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
