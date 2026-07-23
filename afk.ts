// In-memory AFK timer system

const activeTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

export function afkKey(matchId: number, role: "bowler" | "batter"): string {
  return `${matchId}:${role}`;
}

export function clearAfk(matchId: number, role: "bowler" | "batter"): void {
  const key = afkKey(matchId, role);
  const timers = activeTimers.get(key);
  if (timers) {
    timers.forEach(clearTimeout);
    activeTimers.delete(key);
  }
}

export function scheduleAfk(
  matchId: number,
  role: "bowler" | "batter",
  onWarn50: () => void,
  onWarn30: () => void,
  onTimeout: () => Promise<void>,
): void {
  clearAfk(matchId, role);
  const key = afkKey(matchId, role);
  const t1 = setTimeout(onWarn50, 50_000);
  const t2 = setTimeout(onWarn30, 80_000);
  const t3 = setTimeout(async () => {
    activeTimers.delete(key);
    await onTimeout();
  }, 120_000);
  activeTimers.set(key, [t1, t2, t3]);
}

export function clearAllAfk(matchId: number): void {
  clearAfk(matchId, "bowler");
  clearAfk(matchId, "batter");
}
