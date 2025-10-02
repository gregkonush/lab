import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Merge Tailwind classes intelligently while supporting conditional class names
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
