'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Label({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root className={cn('text-sm font-medium', className)} {...props} />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full border border-black/15 bg-white px-3 text-base outline-none focus-visible:border-current',
        className,
      )}
      style={{ borderRadius: 'var(--brand-radius)' }}
      {...props}
    />
  );
}

export function Checkbox({
  id,
  checked,
  onCheckedChange,
  children,
  invalid,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  children: ReactNode;
  invalid?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <CheckboxPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-invalid={invalid ?? false}
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center border bg-white',
          invalid === true ? 'border-red-600' : 'border-black/25',
        )}
        style={{ borderRadius: 'calc(var(--brand-radius) / 3)' }}
      >
        <CheckboxPrimitive.Indicator>
          <Check className="size-4" style={{ color: 'var(--brand-primary)' }} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <Label htmlFor={id} className="cursor-pointer text-sm leading-relaxed font-normal">
        {children}
      </Label>
    </div>
  );
}
