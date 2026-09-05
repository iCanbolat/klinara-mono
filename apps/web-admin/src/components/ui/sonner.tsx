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
