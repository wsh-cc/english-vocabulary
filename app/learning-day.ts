import { DAY } from '@/lib/learning';

export function beijingDayBounds(day: string): readonly [number, number] {
  const start = Date.parse(day + 'T00:00:00+08:00');
  return [start, start + DAY];
}
