import { db } from "@workspace/db";
import { matchesTable, ballsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  updateMatch,
  logBall,
  recordPlayerMatchResult,
  updateBestBowling,
  getPlayer,
} from "./db.js";
import type { Match } from "@workspace/db";

export type PlayerRef = { id: string; name: string };

// ── Innings / scoring helpers ─────────────────────────────────────────────────
export function getInningsScore(m: Match, inn: number) {
  return inn === 1
    ? { score: m.innings1Score, wickets: m.innings1Wickets, balls: m.innings1Balls }
    : { score: m.innings2Score, wickets: m.innings2Wickets, balls: m.innings2Balls };
}

export function maxWickets(m: Match, team: "A" | "B") {
  const players = (team === "A" ? m.teamAPlayers : m.teamBPlayers) as PlayerRef[];
  return Math.max(players.length - 1, 1);
}

export function maxBalls(m: Match) {
  return (m.overs ?? 1) * 6;
}

export function isSoloOut(batterNum: number, bowlerNum: number) {
  return batterNum === bowlerNum;
}

export function isTeamOut(batterNum: number, bowlerNum: number) {
  return batterNum === bowlerNum;
}

// ── Next batter helper ────────────────────────────────────────────────────────
export function nextBatter(m: Match, team: "A" | "B"): PlayerRef | null {
  const order = (
    team === "A" ? m.teamABattingOrder : m.teamBBattingOrder
  ) as PlayerRef[];
  const idx = team === "A" ? m.teamABattingIndex : m.teamBBattingIndex;
  return order[idx] ?? null;
}

// ── Spam-free check ───────────────────────────────────────────────────────────
export function isSpamBlocked(m: Match, num: number): boolean {
  if (!m.spamFreeMode) return false;
  const last = (m.lastBowlerNumbers as number[]) ?? [];
  if (last.length < 2) return false;
  return last[last.length - 1] === num && last[last.length - 2] === num;
}

export function updateBowlerHistory(m: Match, num: number): number[] {
  const last = [...((m.lastBowlerNumbers as number[]) ?? [])];
  last.push(num);
  if (last.length > 3) last.shift();
  return last;
}

// ── Ball resolution ───────────────────────────────────────────────────────────
export interface BallResult {
  runs: number;
  isWicket: boolean;
  milestone?: "50" | "100" | "200";
  hatTrick?: boolean;
  inningsOver?: boolean;
  matchOver?: boolean;
  winnerTeam?: "A" | "B";
  winnerName?: string;
}

export async function processBall(
  match: Match,
  batterId: string,
  batterName: string,
  bowlerId: string,
  batterNum: number,
  bowlerNum: number,
): Promise<{ result: BallResult; updatedMatch: Match }> {
  const isWicket = isTeamOut(batterNum, bowlerNum);
  const runs = isWicket ? 0 : batterNum;

  const inn = match.currentInnings;
  const prev = getInningsScore(match, inn);
  const newScore = prev.score + runs;
  const newBalls = prev.balls + 1;
  const newWickets = prev.wickets + (isWicket ? 1 : 0);

  // Track hat-trick
  let hatTrick = false;
  let newConsecWickets = match.currentBowlerConsecutiveWickets;
  let lastHatBowler = match.lastBowlerIdForHatTrick;
  if (isWicket) {
    if (lastHatBowler === bowlerId) {
      newConsecWickets += 1;
      if (newConsecWickets >= 3) {
        hatTrick = true;
        newConsecWickets = 0;
      }
    } else {
      newConsecWickets = 1;
      lastHatBowler = bowlerId;
    }
  } else {
    newConsecWickets = 0;
    lastHatBowler = bowlerId;
  }

  // Log ball
  const over = Math.floor(prev.balls / 6);
  const ballNum = prev.balls % 6;
  await logBall({
    matchId: match.id,
    innings: inn,
    overNumber: over,
    ballNumber: ballNum,
    batterId,
    bowlerId,
    batterNumber: batterNum,
    bowlerNumber: bowlerNum,
    runs,
    isWicket,
  });

  // Milestone for batter this innings
  let milestone: BallResult["milestone"];
  // Fetch batter innings runs from balls table
  const batterBalls = await db
    .select()
    .from(ballsTable)
    .where(
      and(
        eq(ballsTable.matchId, match.id),
        eq(ballsTable.innings, inn),
        eq(ballsTable.batterId, batterId),
      ),
    );
  const batterInningsRuns = batterBalls.reduce((s, b) => s + b.runs, 0);
  const prevBatterRuns = batterInningsRuns - runs;
  if (prevBatterRuns < 50 && batterInningsRuns >= 50) milestone = "50";
  if (prevBatterRuns < 100 && batterInningsRuns >= 100) milestone = "100";
  if (prevBatterRuns < 200 && batterInningsRuns >= 200) milestone = "200";

  // Check innings end
  const battingTeam = match.battingTeam as "A" | "B";
  const bowlingTeam = match.bowlingTeam as "A" | "B";
  const maxW = maxWickets(match, battingTeam);
  const maxB = maxBalls(match);
  const inningsOver =
    newWickets >= maxW || newBalls >= maxB;

  // Prepare score update
  const scoreUpdate: Partial<typeof matchesTable.$inferInsert> = {};
  if (inn === 1) {
    scoreUpdate.innings1Score = newScore;
    scoreUpdate.innings1Wickets = newWickets;
    scoreUpdate.innings1Balls = newBalls;
  } else {
    scoreUpdate.innings2Score = newScore;
    scoreUpdate.innings2Wickets = newWickets;
    scoreUpdate.innings2Balls = newBalls;
  }
  scoreUpdate.currentBowlerConsecutiveWickets = newConsecWickets;
  scoreUpdate.lastBowlerIdForHatTrick = lastHatBowler;
  scoreUpdate.lastBowlerNumbers = updateBowlerHistory(match, bowlerNum);

  let matchOver = false;
  let winnerTeam: "A" | "B" | undefined;
  let winnerName: string | undefined;

  if (inn === 2) {
    // Check if target chased
    const target = match.target!;
    if (newScore >= target) {
      matchOver = true;
      winnerTeam = battingTeam;
      winnerName = battingTeam === "A" ? (match.teamAName ?? "Team A") : (match.teamBName ?? "Team B");
    } else if (inningsOver) {
      // All out or overs done, bowling team wins
      matchOver = true;
      winnerTeam = bowlingTeam;
      winnerName = bowlingTeam === "A" ? (match.teamAName ?? "Team A") : (match.teamBName ?? "Team B");
    }
  }

  if (matchOver) {
    scoreUpdate.status = "finished";
    scoreUpdate.finishedAt = new Date();
    scoreUpdate.winnerId = winnerTeam;
    scoreUpdate.winnerName = winnerName;
  }

  await updateMatch(match.id, scoreUpdate);

  // Re-fetch updated match
  const [updatedRows] = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, match.id))
    .limit(1);
  const updatedMatch = updatedRows!;

  return {
    result: { runs, isWicket, milestone, hatTrick, inningsOver, matchOver, winnerTeam, winnerName },
    updatedMatch,
  };
}

// ── Solo ball processing ──────────────────────────────────────────────────────
export interface SoloBallResult {
  isWicket: boolean;
  runs: number;
  batterNum: number;
  bowlerNum: number;
}

export function processSoloBall(batterNum: number, bowlerNum: number): SoloBallResult {
  const isWicket = isSoloOut(batterNum, bowlerNum);
  return {
    isWicket,
    runs: isWicket ? 0 : batterNum,
    batterNum,
    bowlerNum,
  };
}
