import { Compass } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n/tr';

export default function NotFound(): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <EmptyState
        icon={Compass}
        title={t('state.notFoundTitle')}
        message={t('state.notFoundBody')}
        footer={
          <Button asChild variant="secondary">
            <Link href="/">{t('state.backHome')}</Link>
          </Button>
        }
      />
    </div>
  );
}
