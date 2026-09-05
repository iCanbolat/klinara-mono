'use client';

import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { t } from '@/i18n/tr';

/**
 * Geri alınamaz bir eylemi onay arkasına alan düğme.
 *
 * "Emin misiniz?" her yere serpilmemeli — kullanıcıyı sorulara alıştırmak, asıl
 * önemli soruyu da okumadan onaylatır. Bu bileşen YALNIZ geri alınamaz işler
 * için: oturum sonlandırma, passkey silme, yayınlama gibi.
 */
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  children,
  ...props
}: Omit<ButtonProps, 'onClick'> & {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button {...props}>{children}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            onClick={onConfirm}
          >
            {confirmLabel ?? title}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
