'use client';

import { MapPin } from 'lucide-react';
import type { PublicBranch } from '@klinara/shared';
import { OptionGroup, RadioOption } from '@/components/ui/option-card';

export function BranchStep({
  branches,
  value,
  onChange,
}: {
  branches: PublicBranch[];
  value: string | null;
  onChange: (branchId: string) => void;
}) {
  return (
    <OptionGroup label="Şube" value={value} onValueChange={onChange}>
      {branches.map((branch, index) => (
        <RadioOption
          key={branch.id}
          value={branch.id}
          index={index}
          leading={<MapPin className="size-5 opacity-60" aria-hidden />}
          title={branch.name}
          description={branch.address}
        />
      ))}
    </OptionGroup>
  );
}
