'use client';

import type { ReactNode } from 'react';
import { ContentEditor } from '@/components/editor/content-editor';

export default function Page(): ReactNode {
  // Yetki kontrolü editörün İÇİNDE: üç durum var (`read-only`, `full`,
  // `misconfigured`) ve genel `PermissionGate` ikisini ayırt edemezdi.
  return <ContentEditor />;
}
