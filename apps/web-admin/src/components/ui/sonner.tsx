'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/*
 * shadcn sürümü `next-themes`ten tema okuyordu; panelde dark mode YOK ve tema
 * sağlayıcısı da yok — okunacak bir şey olmadığı için o bağımlılık kaldırıldı.
 */
export function Toaster(props: ToasterProps): ReactNode {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          // Sonner'ın stili katmansız; Tailwind yardımcıları ezilsin diye `!`.
          toast:
            'group/toast !gap-3 !rounded-xl !border !px-4 !py-3 !shadow-lg !font-sans',
          title: '!font-semibold',
          description: '!text-current !opacity-80',
          icon: '!mt-0.5',
          actionButton:
            '!rounded-lg !bg-primary !px-3 !text-xs !font-medium !text-primary-foreground hover:!bg-primary/90',
          cancelButton: '!rounded-lg !bg-muted !text-muted-foreground',
          closeButton:
            '!border-border !bg-card !text-muted-foreground hover:!bg-muted',
          success: '!border-success/30 !bg-success-soft !text-success',
          info: '!border-link/30 !bg-link-soft !text-link',
          warning: '!border-warning/30 !bg-warning-soft !text-warning',
          error: '!border-destructive/30 !bg-destructive-soft !text-destructive',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      {...props}
    />
  );
}
