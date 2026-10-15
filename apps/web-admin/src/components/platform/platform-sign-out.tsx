'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function PlatformSignOut(): ReactNode {
  const pathname = usePathname();
  if (pathname === '/platform/giris') return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await fetch('/api/platform-session', { method: 'DELETE' });
        window.location.assign('/platform/giris');
      }}
    >
      Çıkış
    </Button>
  );
}
