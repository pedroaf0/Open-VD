import type { StorageInfo } from "@/lib/wp";

export function formatBytes(bytes: number): string {
  const mb = bytes / 1048576;
  if (mb < 1) return `${mb.toFixed(2)} MB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** Percentage of the limit in use (100% when the user is blocked). */
export function pctUsed(s: StorageInfo): number {
  if (s.blocked || s.limitBytes <= 0) return 100;
  return Math.min(100, (s.usedBytes / s.limitBytes) * 100);
}
