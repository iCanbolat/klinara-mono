import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind sınıflarını çakışmasız birleştir. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
