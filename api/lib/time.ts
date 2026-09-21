/** 北京时间（UTC+8）今天 0 点，与服务器 TZ 无关 */
export function startOfTodayShanghai(now = Date.now()): Date {
  const off = 8 * 3600 * 1000;
  const shifted = now + off;
  return new Date(Math.floor(shifted / 86_400_000) * 86_400_000 - off);
}
