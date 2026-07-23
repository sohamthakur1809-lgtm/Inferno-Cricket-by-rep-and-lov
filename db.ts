import { eq, desc, sql, and, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  playersTable,
  matchesTable,
  ballsTable,
  adminMediaTable,
  adminSettingsTable,
  groupsTable,
  type Player,
  type Match,
  type Group,
} from "@workspace/db";

// ── Player helpers ────────────────────────────────────────────────────────────
export async function upsertPlayer(
  telegramId: string,
  firstName: string,
  username?: string,
): Promise<Player> {
  const existing = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.telegramId, telegramId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(playersTable)
      .set({ firstName, username: username ?? existing[0].username })
      .where(eq(playersTable.telegramId, telegramId));
    return { ...existing[0], firstName, username: username ?? existing[0].username };
  }

  const [inserted] = await db
    .insert(playersTable)
    .values({ telegramId, firstName, username })
    .returning();
  return inserted!;
}

export async function getPlayer(telegramId: string): Promise<Player | null> {
  const rows = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.telegramId, telegramId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPlayerByUsername(username: string): Promise<Player | null> {
  const rows = await db
    .select()
    .from(playersTable)
    .where(sql`lower(username) = ${username.toLowerCase()}`)
    .limit(1);
  return rows[0] ?? null;
}

export async function banPlayer(telegramId: string): Promise<void> {
  await db.update(playersTable).set({ banned: true }).where(eq(playersTable.telegramId, telegramId));
}

export async function unbanPlayer(telegramId: string): Promise<void> {
  await db.update(playersTable).set({ banned: false }).where(eq(playersTable.telegramId, telegramId));
}

export async function resetPlayerStats(telegramId: string): Promise<void> {
  await db.update(playersTable).set({
    matchesPlayed: 0, wins: 0, losses: 0, totalRuns: 0, totalWickets: 0,
    totalBallsFaced: 0, totalBallsBowled: 0, totalRunsConceded: 0,
    highestScore: 0, bestBowlingWickets: 0, bestBowlingRuns: 0,
    fifties: 0, hundreds: 0, twoHundreds: 0, mvpAwards: 0, hatTricks: 0,
    totalSixes: 0, totalFours: 0, ducks: 0, orangeCaps: 0, purpleCaps: 0,
    longestWinStreak: 0, currentWinStreak: 0,
  }).where(eq(playersTable.telegramId, telegramId));
}

export async function searchPlayer(query: string): Promise<Player[]> {
  const rows = await db
    .select()
    .from(playersTable)
    .where(
      sql`lower(first_name) like ${`%${query.toLowerCase()}%`} or lower(username) like ${`%${query.toLowerCase()}%`} or telegram_id = ${query}`
    )
    .limit(5);
  return rows;
}

// ── Match helpers ─────────────────────────────────────────────────────────────
export async function getActiveMatch(chatId: string): Promise<Match | null> {
  const rows = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.chatId, chatId))
    .orderBy(desc(matchesTable.createdAt))
    .limit(1);
  const m = rows[0];
  if (!m || m.status === "finished") return null;
  return m;
}

export async function updateMatch(
  matchId: number,
  data: Partial<typeof matchesTable.$inferInsert>,
): Promise<void> {
  await db.update(matchesTable).set(data).where(eq(matchesTable.id, matchId));
}

export async function createMatch(
  data: typeof matchesTable.$inferInsert,
): Promise<Match> {
  const [m] = await db.insert(matchesTable).values(data).returning();
  return m!;
}

export async function getAllActiveMatches(): Promise<Match[]> {
  return db
    .select()
    .from(matchesTable)
    .where(ne(matchesTable.status, "finished"));
}

// ── Ball logging ──────────────────────────────────────────────────────────────
export async function logBall(data: typeof ballsTable.$inferInsert) {
  await db.insert(ballsTable).values(data);
}

// ── Stats update after match ──────────────────────────────────────────────────
export async function recordPlayerMatchResult(opts: {
  telegramId: string;
  runs: number;
  wickets: number;
  ballsFaced: number;
  ballsBowled: number;
  runsConceded: number;
  sixes: number;
  fours?: number;
  won: boolean;
  duck?: boolean;
  isOrangeCap?: boolean;
  isPurpleCap?: boolean;
}) {
  const p = await getPlayer(opts.telegramId);
  if (!p) return;

  const newHS = Math.max(p.highestScore, opts.runs);
  const newFifties = p.fifties + (opts.runs >= 50 && opts.runs < 100 ? 1 : 0);
  const newHundreds = p.hundreds + (opts.runs >= 100 && opts.runs < 200 ? 1 : 0);
  const newTwoHundreds = p.twoHundreds + (opts.runs >= 200 ? 1 : 0);
  const newStreak = opts.won ? p.currentWinStreak + 1 : 0;
  const newLongest = Math.max(p.longestWinStreak, newStreak);

  await db
    .update(playersTable)
    .set({
      matchesPlayed: p.matchesPlayed + 1,
      wins: p.wins + (opts.won ? 1 : 0),
      losses: p.losses + (opts.won ? 0 : 1),
      totalRuns: p.totalRuns + opts.runs,
      totalWickets: p.totalWickets + opts.wickets,
      totalBallsFaced: p.totalBallsFaced + opts.ballsFaced,
      totalBallsBowled: p.totalBallsBowled + opts.ballsBowled,
      totalRunsConceded: p.totalRunsConceded + opts.runsConceded,
      highestScore: newHS,
      fifties: newFifties,
      hundreds: newHundreds,
      twoHundreds: newTwoHundreds,
      totalSixes: p.totalSixes + opts.sixes,
      totalFours: p.totalFours + (opts.fours ?? 0),
      ducks: p.ducks + (opts.duck ? 1 : 0),
      orangeCaps: p.orangeCaps + (opts.isOrangeCap ? 1 : 0),
      purpleCaps: p.purpleCaps + (opts.isPurpleCap ? 1 : 0),
      currentWinStreak: newStreak,
      longestWinStreak: newLongest,
    })
    .where(eq(playersTable.telegramId, opts.telegramId));
}

export async function updateBestBowling(
  telegramId: string,
  wickets: number,
  runs: number,
) {
  const p = await getPlayer(telegramId);
  if (!p) return;
  const better =
    wickets > p.bestBowlingWickets ||
    (wickets === p.bestBowlingWickets && runs < p.bestBowlingRuns);
  if (better) {
    await db
      .update(playersTable)
      .set({ bestBowlingWickets: wickets, bestBowlingRuns: runs })
      .where(eq(playersTable.telegramId, telegramId));
  }
}

// ── Rankings ──────────────────────────────────────────────────────────────────
export async function getTopRunScorers(limit = 10): Promise<Player[]> {
  return db
    .select()
    .from(playersTable)
    .orderBy(desc(playersTable.totalRuns))
    .limit(limit);
}

export async function getTopWicketTakers(limit = 10): Promise<Player[]> {
  return db
    .select()
    .from(playersTable)
    .orderBy(desc(playersTable.totalWickets))
    .limit(limit);
}

export async function getTopWinners(limit = 10): Promise<Player[]> {
  return db
    .select()
    .from(playersTable)
    .orderBy(desc(playersTable.wins))
    .limit(limit);
}

export async function getTopSixHitters(limit = 10): Promise<Player[]> {
  return db
    .select()
    .from(playersTable)
    .orderBy(desc(playersTable.totalSixes))
    .limit(limit);
}

export async function getTopStrikeRates(limit = 10): Promise<Player[]> {
  return db
    .select()
    .from(playersTable)
    .where(sql`total_balls_faced >= 30`)
    .orderBy(desc(sql`(total_runs::float / NULLIF(total_balls_faced, 0)) * 100`))
    .limit(limit);
}

export async function getTopEconomyBowlers(limit = 10): Promise<Player[]> {
  return db
    .select()
    .from(playersTable)
    .where(sql`total_balls_bowled >= 30`)
    .orderBy(sql`(total_runs_conceded::float / NULLIF(total_balls_bowled, 0)) * 6 ASC`)
    .limit(limit);
}

export async function getTopHatTrickTakers(limit = 10): Promise<Player[]> {
  return db
    .select()
    .from(playersTable)
    .where(sql`hat_tricks > 0`)
    .orderBy(desc(playersTable.hatTricks))
    .limit(limit);
}

export async function getTopWinStreaks(limit = 10): Promise<Player[]> {
  return db
    .select()
    .from(playersTable)
    .orderBy(desc(playersTable.longestWinStreak))
    .limit(limit);
}

// ── Records ───────────────────────────────────────────────────────────────────
export async function getRecords() {
  const [topRun, topWickets, topSixes, topStreak, highTeam] = await Promise.all([
    db.select().from(playersTable).orderBy(desc(playersTable.highestScore)).limit(1),
    db.select().from(playersTable).orderBy(desc(playersTable.totalWickets)).limit(1),
    db.select().from(playersTable).orderBy(desc(playersTable.totalSixes)).limit(1),
    db.select().from(playersTable).orderBy(desc(playersTable.longestWinStreak)).limit(1),
    db.select().from(matchesTable).where(eq(matchesTable.status, "finished")).orderBy(desc(matchesTable.innings1Score)).limit(1),
  ]);
  return {
    topRun: topRun[0],
    topWickets: topWickets[0],
    topSixes: topSixes[0],
    topStreak: topStreak[0],
    highTeam: highTeam[0],
  };
}

// ── Admin media — multiple images per slot ────────────────────────────────────
export async function getMediaFileIds(key: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(adminMediaTable)
    .where(eq(adminMediaTable.key, key))
    .limit(1);
  return (rows[0]?.fileIds as string[]) ?? [];
}

export async function getRandomMediaFileId(key: string): Promise<string | null> {
  const ids = await getMediaFileIds(key);
  if (!ids.length) return null;
  return ids[Math.floor(Math.random() * ids.length)]!;
}

export async function appendMedia(key: string, fileId: string): Promise<number> {
  const existing = await getMediaFileIds(key);
  const updated = [...existing, fileId];
  await db
    .insert(adminMediaTable)
    .values({ key, fileIds: updated })
    .onConflictDoUpdate({
      target: adminMediaTable.key,
      set: { fileIds: updated, updatedAt: sql`now()` },
    });
  return updated.length;
}

export async function clearMedia(key: string): Promise<void> {
  await db
    .insert(adminMediaTable)
    .values({ key, fileIds: [] })
    .onConflictDoUpdate({
      target: adminMediaTable.key,
      set: { fileIds: [], updatedAt: sql`now()` },
    });
}

export async function getMediaCount(key: string): Promise<number> {
  return (await getMediaFileIds(key)).length;
}

// ── Admin settings ────────────────────────────────────────────────────────────
export async function getSetting(key: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(adminSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: adminSettingsTable.key,
      set: { value, updatedAt: sql`now()` },
    });
}

export async function getBotStats() {
  const [
    [{ count: totalPlayers }],
    [{ count: totalMatches }],
    [{ count: activeMatches }],
    [{ count: soloMatches }],
    [{ count: teamMatches }],
    [{ count: totalGroups }],
    [{ count: bannedPlayers }],
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(playersTable),
    db.select({ count: sql<number>`count(*)` }).from(matchesTable).where(eq(matchesTable.status, "finished")),
    db.select({ count: sql<number>`count(*)` }).from(matchesTable).where(sql`status != 'finished'`),
    db.select({ count: sql<number>`count(*)` }).from(matchesTable).where(and(eq(matchesTable.status, "finished"), eq(matchesTable.mode, "solo"))),
    db.select({ count: sql<number>`count(*)` }).from(matchesTable).where(and(eq(matchesTable.status, "finished"), eq(matchesTable.mode, "team"))),
    db.select({ count: sql<number>`count(*)` }).from(groupsTable),
    db.select({ count: sql<number>`count(*)` }).from(playersTable).where(eq(playersTable.banned, true)),
  ]);
  return { totalPlayers, totalMatches, activeMatches, soloMatches, teamMatches, totalGroups, bannedPlayers };
}

// ── Group tracking ─────────────────────────────────────────────────────────────
export async function upsertGroup(chatId: string, title?: string): Promise<void> {
  await db
    .insert(groupsTable)
    .values({ chatId, title, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: groupsTable.chatId,
      set: { title: title ?? sql`groups.title`, lastSeenAt: sql`now()` },
    });
}

export async function getAllGroups(): Promise<Group[]> {
  return db.select().from(groupsTable).orderBy(desc(groupsTable.lastSeenAt));
}

export async function getGroupCount(): Promise<number> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(groupsTable);
  return count;
}
