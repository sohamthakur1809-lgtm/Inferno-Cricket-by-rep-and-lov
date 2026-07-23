import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../context.js";
import {
  getActiveMatch,
  createMatch,
  updateMatch,
  upsertPlayer,
  recordPlayerMatchResult,
  updateBestBowling,
} from "../utils/db.js";
import { sendWithMedia, sendWithMediaToChat, MEDIA_KEYS } from "../utils/media.js";
import { soloLobbyText, mention, escHtml, soloScorecardText } from "../utils/format.js";
import { processSoloBall, isSpamBlocked } from "../utils/game.js";
import { commentary } from "../utils/commentary.js";
import { isAdmin } from "../utils/admin.js";
import { db } from "@workspace/db";
import { matchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { scheduleAfk, clearAfk, clearAllAfk } from "../utils/afk.js";

// Rich player state stored in soloPlayers jsonb
export type SoloPlayer = {
  id: string;
  name: string;
  runs: number;
  wickets: number;
  ballsFaced: number;
  ballsBowled: number;
  fours: number;
  sixes: number;
  out: boolean;
  eliminated?: boolean;
};

function parseSoloPlayers(raw: unknown): SoloPlayer[] {
  const arr = (raw as SoloPlayer[]) ?? [];
  return arr.map((p) => ({
    id: p.id,
    name: p.name,
    runs: p.runs ?? 0,
    wickets: p.wickets ?? 0,
    ballsFaced: p.ballsFaced ?? 0,
    ballsBowled: p.ballsBowled ?? 0,
    fours: p.fours ?? 0,
    sixes: p.sixes ?? 0,
    out: p.out ?? false,
    eliminated: p.eliminated ?? false,
  }));
}

function nextBowlerIdx(players: SoloPlayer[], currentBowlerIdx: number, batterId: string): number {
  const n = players.length;
  let idx = (currentBowlerIdx + 1) % n;
  let attempts = 0;
  while ((players[idx]!.id === batterId || players[idx]!.out) && attempts < n) {
    idx = (idx + 1) % n;
    attempts++;
  }
  return idx;
}

function findNextBatter(players: SoloPlayer[], currentBatterId: string): SoloPlayer | null {
  const currentIdx = players.findIndex((p) => p.id === currentBatterId);
  const n = players.length;
  for (let i = 1; i < n; i++) {
    const p = players[(currentIdx + i) % n]!;
    if (!p.out) return p;
  }
  return null;
}

function allOut(players: SoloPlayer[]): boolean {
  return players.every((p) => p.out);
}

export function registerSoloHandlers(bot: Bot<BotContext>) {
  bot.callbackQuery("solo:3", handleSpellSelect(3));
  bot.callbackQuery("solo:6", handleSpellSelect(6));

  bot.command("joinsolo", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "solo" || match.status !== "lobby") {
      await ctx.reply("No solo lobby active. Use /start to create one.");
      return;
    }
    const user = ctx.from!;
    await upsertPlayer(String(user.id), user.first_name, user.username);
    const players = parseSoloPlayers(match.soloPlayers);
    if (players.find((p) => p.id === String(user.id))) {
      await ctx.reply("You are already in the lobby!");
      return;
    }
    players.push({ id: String(user.id), name: user.first_name, runs: 0, wickets: 0, ballsFaced: 0, ballsBowled: 0, fours: 0, sixes: 0, out: false });
    await updateMatch(match.id, { soloPlayers: players });
    if (match.lobbyMessageId) {
      try {
        await ctx.api.editMessageText(
          ctx.chat.id,
          match.lobbyMessageId,
          soloLobbyText(players, match.spellLength!),
          { parse_mode: "HTML" },
        );
      } catch { /* ignore */ }
    }
    await ctx.reply(`✅ ${escHtml(user.first_name)} joined! (${players.length} players)`, { parse_mode: "HTML" });
  });

  bot.command("leavesolo", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "solo" || match.status !== "lobby") return;
    const user = ctx.from!;
    let players = parseSoloPlayers(match.soloPlayers);
    players = players.filter((p) => p.id !== String(user.id));
    await updateMatch(match.id, { soloPlayers: players });
    if (match.lobbyMessageId) {
      try {
        await ctx.api.editMessageText(
          ctx.chat.id,
          match.lobbyMessageId,
          soloLobbyText(players, match.spellLength!),
          { parse_mode: "HTML" },
        );
      } catch { /* ignore */ }
    }
    await ctx.reply(`❌ ${escHtml(user.first_name)} left the lobby.`, { parse_mode: "HTML" });
  });

  bot.command("forcestart", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const admin = await isAdmin(ctx);
    if (!admin) {
      await ctx.reply("Only group admins can use /forcestart.");
      return;
    }
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "solo" || match.status !== "lobby") {
      await ctx.reply("No solo lobby active right now.");
      return;
    }
    await startSoloMatch(ctx, match.id, parseSoloPlayers(match.soloPlayers), match.spellLength!);
  });

  // Solo batter button callback (1-6)
  bot.callbackQuery(/^solo_bat:([1-6])$/, async (ctx) => {
    const match = await getActiveMatch(String(ctx.chat!.id));
    if (!match || match.mode !== "solo" || match.status !== "live") {
      await ctx.answerCallbackQuery();
      return;
    }

    const userId = String(ctx.from!.id);
    if (match.currentStrikerId !== userId) {
      await ctx.answerCallbackQuery("It's not your turn!");
      return;
    }

    if (match.pendingBowlerNumber === null || match.pendingBowlerNumber === undefined) {
      await ctx.answerCallbackQuery("Bowler hasn't sent their number yet. Wait a moment!");
      return;
    }

    await ctx.answerCallbackQuery();
    clearAfk(match.id, "batter");

    const batterNum = parseInt(ctx.match[1]!);
    const bowlerNum = match.pendingBowlerNumber;
    await runSoloBall(ctx, match, userId, batterNum, bowlerNum);
  });
}

export async function handleSoloGroupBatterInput(ctx: BotContext, num: number): Promise<boolean> {
  if (!ctx.chat || ctx.chat.type === "private") return false;
  const match = await getActiveMatch(String(ctx.chat.id));
  if (!match || match.mode !== "solo" || match.status !== "live") return false;

  const userId = String(ctx.from!.id);
  if (match.currentStrikerId !== userId) return false;
  if (match.pendingBowlerNumber === null || match.pendingBowlerNumber === undefined) return false;

  clearAfk(match.id, "batter");
  await runSoloBall(ctx, match, userId, num, match.pendingBowlerNumber);
  return true;
}

function handleSpellSelect(spell: number) {
  return async (ctx: BotContext) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type === "private") return;
    const chatId = String(ctx.chat!.id);

    const existing = await getActiveMatch(chatId);
    if (existing) {
      await ctx.reply("A match is already active in this group!");
      return;
    }

    const user = ctx.from!;
    await upsertPlayer(String(user.id), user.first_name, user.username);

    const players: SoloPlayer[] = [{ id: String(user.id), name: user.first_name, runs: 0, wickets: 0, ballsFaced: 0, ballsBowled: 0, fours: 0, sixes: 0, out: false }];
    const match = await createMatch({
      chatId,
      mode: "solo",
      status: "lobby",
      spellLength: spell,
      soloPlayers: players,
    });

    const sent = await ctx.reply(soloLobbyText(players, spell), { parse_mode: "HTML" });
    await updateMatch(match.id, { lobbyMessageId: sent.message_id });
  };
}

export async function startSoloMatch(
  ctx: BotContext,
  matchId: number,
  players: SoloPlayer[],
  spellLength: number,
) {
  if (players.length < 2) {
    await ctx.reply("At least 2 players needed! Use /joinsolo to join.");
    return;
  }

  const batter = players[0]!;
  const bowler = players[1]!;
  const bowlerIdx = 1;

  const initPlayers: SoloPlayer[] = players.map((p) => ({
    ...p, runs: 0, wickets: 0, ballsFaced: 0, ballsBowled: 0, fours: 0, sixes: 0, out: false, eliminated: false,
  }));

  await updateMatch(matchId, {
    status: "live",
    currentStrikerId: batter.id,
    currentBowlerId: bowler.id,
    teamABattingIndex: bowlerIdx,
    innings1Balls: 0,
    soloPlayers: initPlayers,
    pendingBowlerNumber: null,
  });

  const chatId = ctx.chat?.type !== "private" ? String(ctx.chat!.id) : null;
  if (!chatId) return;

  const playerList = initPlayers.map((p, i) => `${i + 1}. ${escHtml(p.name)}`).join("\n");

  await sendWithMedia(
    ctx,
    MEDIA_KEYS.MATCH_START_BANNER,
    `🏏 <b>SOLO MATCH STARTED!</b>\n\n` +
      `<b>Players (${initPlayers.length}):</b>\n${playerList}\n\n` +
      `🏏 First Batter: ${mention(batter.name, batter.id)}\n` +
      `🎯 First Bowler: ${mention(bowler.name, bowler.id)}\n\n` +
      `⚡ Spell: <b>${spellLength} balls</b> per spell\n` +
      `<i>Same number = ❌ OUT | AFK = ELIMINATED!</i>`,
    { parse_mode: "HTML" },
  );

  await promptSoloBowler(ctx, matchId, bowler.id, bowler.name, batter.name, chatId, 1, spellLength);
}

export async function promptSoloBowler(
  ctx: BotContext,
  matchId: number,
  bowlerId: string,
  bowlerName: string,
  batterName: string,
  chatId: string,
  ballNum: number,
  spellLength: number,
) {
  const dmButton = new InlineKeyboard().url(
    "📩 Open DM",
    `https://t.me/${ctx.me.username}?start=bowl`,
  );

  await sendWithMediaToChat(
    ctx.api,
    chatId,
    MEDIA_KEYS.BOWLING_BANNER,
    commentary.bowlingPrompt(mention(bowlerName, bowlerId), mention(batterName, "0"), ballNum, spellLength, "solo"),
    { reply_markup: dmButton, parse_mode: "HTML" },
  );

  try {
    await ctx.api.sendMessage(
      bowlerId,
      commentary.bowlerDmPrompt(batterName, ballNum, spellLength),
      { parse_mode: "HTML" },
    );
  } catch { /* user hasn't started DM */ }

  scheduleAfk(
    matchId,
    "bowler",
    () => { ctx.api.sendMessage(chatId, commentary.afkWarn50(bowlerName, "bowler"), { parse_mode: "HTML" }).catch(() => {}); },
    () => { ctx.api.sendMessage(chatId, commentary.afkWarn30(bowlerName), { parse_mode: "HTML" }).catch(() => {}); },
    async () => {
      const row = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId)).limit(1);
      const m = row[0];
      if (!m || m.status !== "live" || m.currentBowlerId !== bowlerId) return;

      // SOLO AFK — BOWLER ELIMINATED
      const players = parseSoloPlayers(m.soloPlayers);
      const bowler = players.find((p) => p.id === bowlerId);
      if (!bowler) return;

      bowler.out = true;
      bowler.eliminated = true;

      await ctx.api.sendMessage(chatId, commentary.soloEliminated(bowlerName), { parse_mode: "HTML" }).catch(() => {});

      await updateMatch(matchId, { soloPlayers: players });

      // Check if all out after elimination
      if (allOut(players)) {
        await handleSoloGameOver(ctx, m as NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>, players);
        return;
      }

      // Find a new bowler (not the current batter)
      const batterId = m.currentStrikerId ?? "";
      const batter = players.find((p) => p.id === batterId);
      const bowlerIdx = m.teamABattingIndex;
      const newBowlerIdx = nextBowlerIdx(players, bowlerIdx, batterId);
      const newBowler = players[newBowlerIdx];

      if (!newBowler) {
        await handleSoloGameOver(ctx, m as NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>, players);
        return;
      }

      await updateMatch(matchId, {
        currentBowlerId: newBowler.id,
        teamABattingIndex: newBowlerIdx,
        innings1Balls: 0,
      });

      await ctx.api.sendMessage(
        chatId,
        `🔄 ${mention(newBowler.name, newBowler.id)} is the new bowler!`,
        { parse_mode: "HTML" },
      ).catch(() => {});

      await promptSoloBowler(ctx, matchId, newBowler.id, newBowler.name, batter?.name ?? "Batter", chatId, 1, spellLength);
    },
  );
}

export async function handleSoloDmBowlerInput(
  ctx: BotContext,
  bowlerId: string,
  num: number,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.currentBowlerId, bowlerId))
    .limit(10);

  const match = rows.find((m) => m.status === "live" && m.mode === "solo");
  if (!match) return false;

  clearAfk(match.id, "bowler");

  if (isSpamBlocked(match, num)) {
    await ctx.reply(commentary.spamBlocked(num), { parse_mode: "HTML" });
    return true;
  }

  await updateMatch(match.id, { pendingBowlerNumber: num });

  await ctx.reply(
    `🔒 <b>Number locked!</b>\n\nWaiting for the batter in the group...`,
    { parse_mode: "HTML" },
  );

  const spellLength = match.spellLength ?? 3;
  const spellBalls = match.innings1Balls;
  const ballNum = spellBalls + 1;

  const players = parseSoloPlayers(match.soloPlayers);
  const striker = players.find((p) => p.id === match.currentStrikerId);
  const strikerName = striker?.name ?? "Batter";

  const batKb = new InlineKeyboard();
  [1, 2, 3, 4, 5, 6].forEach((n) => batKb.text(String(n), `solo_bat:${n}`));

  await sendWithMediaToChat(
    ctx.api,
    match.chatId,
    MEDIA_KEYS.BATTING_BANNER,
    commentary.battingPrompt(mention(strikerName, match.currentStrikerId ?? "0"), ballNum, spellLength, "solo"),
    { parse_mode: "HTML", reply_markup: batKb },
  );

  scheduleAfk(
    match.id,
    "batter",
    () => { ctx.api.sendMessage(match.chatId, commentary.afkWarn50(strikerName, "batter"), { parse_mode: "HTML" }).catch(() => {}); },
    () => { ctx.api.sendMessage(match.chatId, commentary.afkWarn30(strikerName), { parse_mode: "HTML" }).catch(() => {}); },
    async () => {
      const row = await db.select().from(matchesTable).where(eq(matchesTable.id, match.id)).limit(1);
      const m = row[0];
      if (!m || m.status !== "live") return;

      // SOLO AFK — BATTER ELIMINATED
      const players = parseSoloPlayers(m.soloPlayers);
      const batter = players.find((p) => p.id === m.currentStrikerId);
      if (!batter) return;

      batter.out = true;
      batter.eliminated = true;

      await ctx.api.sendMessage(match.chatId, commentary.soloEliminated(strikerName), { parse_mode: "HTML" }).catch(() => {});
      await updateMatch(m.id, { soloPlayers: players, pendingBowlerNumber: null });

      if (allOut(players)) {
        await handleSoloGameOver(ctx, m as NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>, players);
        return;
      }

      const nextBatter = findNextBatter(players, m.currentStrikerId ?? "");
      if (!nextBatter) {
        await handleSoloGameOver(ctx, m as NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>, players);
        return;
      }

      const bowlerIdx = m.teamABattingIndex;
      const newBowlerIdx = nextBowlerIdx(players, bowlerIdx, nextBatter.id);
      const newBowler = players[newBowlerIdx]!;

      await updateMatch(m.id, {
        currentStrikerId: nextBatter.id,
        currentBowlerId: newBowler.id,
        teamABattingIndex: newBowlerIdx,
        innings1Balls: 0,
      });

      await ctx.api.sendMessage(
        match.chatId,
        `🏏 Next batter: ${mention(nextBatter.name, nextBatter.id)}\n🎯 Bowler: ${mention(newBowler.name, newBowler.id)}`,
        { parse_mode: "HTML" },
      ).catch(() => {});

      await promptSoloBowler(ctx, m.id, newBowler.id, newBowler.name, nextBatter.name, match.chatId, 1, spellLength);
    },
  );

  return true;
}

async function runSoloBall(
  ctx: BotContext,
  match: NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>,
  batterId: string,
  batterNum: number,
  bowlerNum: number,
) {
  clearAllAfk(match.id);
  await updateMatch(match.id, { pendingBowlerNumber: null });

  const players = parseSoloPlayers(match.soloPlayers);
  const batter = players.find((p) => p.id === batterId)!;
  const bowler = players.find((p) => p.id === match.currentBowlerId)!;
  const spellLength = match.spellLength ?? 3;
  const spellBalls = match.innings1Balls;
  const bowlerIdx = match.teamABattingIndex;

  const result = processSoloBall(batterNum, bowlerNum);

  // Reveal — only batter's number
  const revealLine = `🏏 ${mention(batter.name, batterId)} played <b>${batterNum}</b>`;
  const runMediaKey = result.isWicket
    ? MEDIA_KEYS.WICKET
    : ([MEDIA_KEYS.RUN_0, MEDIA_KEYS.RUN_1, MEDIA_KEYS.RUN_2, MEDIA_KEYS.RUN_3, MEDIA_KEYS.RUN_4, MEDIA_KEYS.RUN_5, MEDIA_KEYS.RUN_6][result.runs] ?? MEDIA_KEYS.RUN_1);

  const resultCommentary = result.isWicket
    ? commentary.wicket(batter.name, bowler.name)
    : commentary.runs(result.runs);

  await sendWithMedia(ctx, runMediaKey, `${revealLine}\n\n${resultCommentary}`, { parse_mode: "HTML" });

  // Update player stats in array
  batter.runs += result.runs;
  batter.ballsFaced += 1;
  if (result.runs === 4) batter.fours++;
  if (result.runs === 6) batter.sixes++;
  bowler.wickets += result.isWicket ? 1 : 0;
  bowler.ballsBowled += 1;

  const newSpellBalls = spellBalls + 1;
  const spellDone = newSpellBalls >= spellLength;

  if (result.isWicket) batter.out = true;

  await updateMatch(match.id, {
    soloPlayers: players,
    innings1Balls: spellDone || result.isWicket ? 0 : newSpellBalls,
  });

  // Live scoreline
  const battersStatus = players
    .filter((p) => !p.out)
    .map((p) => `${escHtml(p.name)}: <b>${p.runs}</b>`)
    .join(" | ");
  const outStatus = players.filter((p) => p.out).map((p) => `❌ ${escHtml(p.name)}: ${p.runs}`).join(" | ");
  let statusLine = `📊 Active: ${battersStatus || "—"}`;
  if (outStatus) statusLine += `  |  Out: ${outStatus}`;
  await ctx.reply(statusLine, { parse_mode: "HTML" });

  // Check game over
  if (result.isWicket) {
    if (allOut(players)) {
      await handleSoloGameOver(ctx, match, players);
      return;
    }

    const nextBatter = findNextBatter(players, batterId);
    if (!nextBatter) {
      await handleSoloGameOver(ctx, match, players);
      return;
    }

    const newBowlerIdx = nextBowlerIdx(players, bowlerIdx, nextBatter.id);
    const newBowler = players[newBowlerIdx]!;

    await updateMatch(match.id, {
      currentStrikerId: nextBatter.id,
      currentBowlerId: newBowler.id,
      teamABattingIndex: newBowlerIdx,
      innings1Balls: 0,
    });

    await ctx.reply(
      `💀 <b>${escHtml(batter.name)} is OUT!</b>\n\n` +
        `🏏 Next: ${mention(nextBatter.name, nextBatter.id)}\n` +
        `🎯 Bowler: ${mention(newBowler.name, newBowler.id)} (new spell)`,
      { parse_mode: "HTML" },
    );

    await promptSoloBowler(ctx, match.id, newBowler.id, newBowler.name, nextBatter.name, match.chatId, 1, spellLength);
    return;
  }

  if (spellDone) {
    const newBowlerIdx = nextBowlerIdx(players, bowlerIdx, batterId);
    const newBowler = players[newBowlerIdx]!;

    await updateMatch(match.id, {
      currentBowlerId: newBowler.id,
      teamABattingIndex: newBowlerIdx,
      innings1Balls: 0,
    });

    await ctx.reply(
      `🔄 Spell over! ${mention(newBowler.name, newBowler.id)} bowls next to ${mention(batter.name, batterId)}`,
      { parse_mode: "HTML" },
    );

    await promptSoloBowler(ctx, match.id, newBowler.id, newBowler.name, batter.name, match.chatId, 1, spellLength);
    return;
  }

  // Continue same bowler, same batter
  const nextBallNum = newSpellBalls + 1;
  await promptSoloBowler(ctx, match.id, bowler.id, bowler.name, batter.name, match.chatId, nextBallNum, spellLength);
}

async function handleSoloGameOver(
  ctx: BotContext,
  match: NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>,
  players: SoloPlayer[],
) {
  clearAllAfk(match.id);
  await updateMatch(match.id, { status: "finished", finishedAt: new Date() });

  const byRuns = [...players].sort((a, b) => b.runs - a.runs);
  const byWickets = [...players].sort((a, b) => b.wickets - a.wickets);
  const orangeCap = byRuns[0]!;
  const purpleCap = byWickets[0]!;

  // Build per-bowler runs conceded by collecting balls faced by OTHER players that THAT bowler bowled
  // Simplified: we track total balls bowled and compute eco from their wickets
  const scorecard = soloScorecardText(players);
  await sendWithMedia(ctx, MEDIA_KEYS.VICTORY_BANNER, scorecard, { parse_mode: "HTML" });

  // OmniDAi solo summary
  const totalRuns = players.reduce((s, p) => s + p.runs, 0);
  const totalBalls = players.reduce((s, p) => s + p.ballsFaced, 0);
  await ctx.reply(
    commentary.soloOmniSummary(orangeCap.name, orangeCap.runs, totalRuns, totalBalls),
    { parse_mode: "HTML" },
  );

  // Update DB stats
  for (const p of players) {
    const isOrangeCap = p.id === orangeCap.id;
    const isPurpleCap = p.id === purpleCap.id;
    const duck = p.runs === 0 && p.ballsFaced > 0 && p.out;
    await recordPlayerMatchResult({
      telegramId: p.id,
      runs: p.runs,
      wickets: p.wickets,
      ballsFaced: p.ballsFaced,
      ballsBowled: p.ballsBowled,
      runsConceded: 0,
      sixes: p.sixes,
      fours: p.fours,
      won: isOrangeCap,
      duck,
      isOrangeCap,
      isPurpleCap,
    }).catch(() => {});
    await updateBestBowling(p.id, p.wickets, 0).catch(() => {});
  }
}

export async function getSoloMatch(matchId: number) {
  const rows = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, matchId))
    .limit(1);
  return rows[0] ?? null;
}
