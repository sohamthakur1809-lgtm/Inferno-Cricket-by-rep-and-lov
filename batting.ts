import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../context.js";
import { getActiveMatch, updateMatch, recordPlayerMatchResult, updateBestBowling } from "../utils/db.js";
import { sendWithMedia, sendWithMediaToChat, MEDIA_KEYS } from "../utils/media.js";
import { mention, escHtml, formatScore } from "../utils/format.js";
import { processBall, isSpamBlocked, type PlayerRef } from "../utils/game.js";
import { commentary } from "../utils/commentary.js";
import { isAdmin } from "../utils/admin.js";
import { db } from "@workspace/db";
import { ballsTable, matchesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { scheduleAfk, clearAfk, clearAllAfk } from "../utils/afk.js";

export function registerBattingHandlers(bot: Bot<BotContext>) {
  // /batting 1 or /batting 2
  bot.command("batting", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team" || match.status !== "batting_order") {
      await ctx.reply("Batting order cannot be set right now. Complete the toss first.");
      return;
    }

    const battingCapId =
      match.battingTeam === "A" ? match.teamACaptainId : match.teamBCaptainId;
    const hostId = match.hostId;

    // Captain OR host can select batters
    if (battingCapId !== String(ctx.from!.id) && hostId !== String(ctx.from!.id)) {
      await ctx.reply("Only the batting captain or host can set the batting order.");
      return;
    }

    const parts = ctx.message!.text.split(" ");
    const slot = parseInt(parts[1] ?? "");
    if (slot !== 1 && slot !== 2) {
      await ctx.reply("Usage:\n/batting 1 — Select Striker\n/batting 2 — Select Non-Striker");
      return;
    }

    const battingTeamPlayers = (
      match.battingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
    ) as PlayerRef[];

    const kb = new InlineKeyboard();
    battingTeamPlayers.forEach((p, i) => {
      kb.text(p.name, `bat_select:${slot}:${p.id}`);
      if ((i + 1) % 2 === 0) kb.row();
    });
    kb.row();

    await ctx.reply(
      `🏏 <b>Select ${slot === 1 ? "Striker" : "Non-Striker"}:</b>`,
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  // bat_select callback
  bot.callbackQuery(/^bat_select:(\d):(.+)$/, async (ctx) => {
    const match = await getActiveMatch(String(ctx.chat!.id));
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }

    const battingCapId =
      match.battingTeam === "A" ? match.teamACaptainId : match.teamBCaptainId;
    const isCapOrHost =
      battingCapId === String(ctx.from!.id) || match.hostId === String(ctx.from!.id);

    if (!isCapOrHost) {
      await ctx.answerCallbackQuery("Only the batting captain or host can select batters!");
      return;
    }

    await ctx.answerCallbackQuery();

    const slot = parseInt(ctx.match[1]!);
    const playerId = ctx.match[2]!;

    const battingTeamPlayers = (
      match.battingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
    ) as PlayerRef[];
    const player = battingTeamPlayers.find((p) => p.id === playerId);
    if (!player) return;

    if (slot === 1) {
      await updateMatch(match.id, { currentStrikerId: playerId });
      await ctx.reply(`✅ Striker: ${mention(player.name, playerId)}`, { parse_mode: "HTML" });
    } else {
      await updateMatch(match.id, { currentNonStrikerId: playerId });
      await ctx.reply(`✅ Non-Striker: ${mention(player.name, playerId)}`, { parse_mode: "HTML" });
    }

    const updated = await getActiveMatch(String(ctx.chat!.id));
    if (
      updated?.currentStrikerId &&
      updated?.currentNonStrikerId &&
      updated.status === "batting_order"
    ) {
      const bowlingCapId =
        updated.bowlingTeam === "A" ? updated.teamACaptainId : updated.teamBCaptainId;
      const bowlingTeamPlayers = (
        updated.bowlingTeam === "A" ? updated.teamAPlayers : updated.teamBPlayers
      ) as PlayerRef[];
      const bowlingCapName =
        bowlingTeamPlayers.find((p) => p.id === bowlingCapId)?.name ?? "Captain";

      await updateMatch(match.id, { status: "bowling_order" });
      await ctx.reply(
        `✅ <b>Batting order set!</b>\n\n` +
          `${mention(bowlingCapName, bowlingCapId!)} — select your bowler:\n/bowling`,
        { parse_mode: "HTML" },
      );
    }
  });

  // /bowling
  bot.command("bowling", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team" || match.status !== "bowling_order") {
      await ctx.reply("Not the right time to select a bowler.");
      return;
    }

    const bowlingCapId =
      match.bowlingTeam === "A" ? match.teamACaptainId : match.teamBCaptainId;
    const isCapOrHost =
      bowlingCapId === String(ctx.from!.id) || match.hostId === String(ctx.from!.id);

    if (!isCapOrHost) {
      await ctx.reply("Only the bowling captain or host can select the bowler.");
      return;
    }

    const bowlingTeamPlayers = (
      match.bowlingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
    ) as PlayerRef[];

    const kb = new InlineKeyboard();
    bowlingTeamPlayers.forEach((p, i) => {
      kb.text(p.name, `bowl_select:${p.id}`);
      if ((i + 1) % 2 === 0) kb.row();
    });
    kb.row();

    await ctx.reply(`🎯 <b>Select Bowler:</b>`, { parse_mode: "HTML", reply_markup: kb });
  });

  // bowl_select callback
  bot.callbackQuery(/^bowl_select:(.+)$/, async (ctx) => {
    const match = await getActiveMatch(String(ctx.chat!.id));
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }

    const bowlingCapId =
      match.bowlingTeam === "A" ? match.teamACaptainId : match.teamBCaptainId;
    const isCapOrHost =
      bowlingCapId === String(ctx.from!.id) || match.hostId === String(ctx.from!.id);

    if (!isCapOrHost) {
      await ctx.answerCallbackQuery("Only the bowling captain or host can select the bowler!");
      return;
    }

    await ctx.answerCallbackQuery();

    const playerId = ctx.match[1]!;
    const bowlingTeamPlayers = (
      match.bowlingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
    ) as PlayerRef[];
    const bowler = bowlingTeamPlayers.find((p) => p.id === playerId);
    if (!bowler) return;

    const battingTeamPlayers = (
      match.battingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
    ) as PlayerRef[];
    const striker = battingTeamPlayers.find((p) => p.id === match.currentStrikerId);
    const nonStriker = battingTeamPlayers.find((p) => p.id === match.currentNonStrikerId);

    await updateMatch(match.id, {
      currentBowlerId: playerId,
      status: "live",
    });

    const currentBalls = match.currentInnings === 1 ? match.innings1Balls : match.innings2Balls;
    const totalBalls = (match.overs ?? 1) * 6;

    // If we're resuming mid-over after an AFK penalty, skip the match-start banner
    if (currentBalls > 0) {
      await ctx.reply(
        `🎯 <b>New Bowler: ${escHtml(bowler.name)}</b>\n\n` +
        `Ball resumes from ${currentBalls + 1}/${totalBalls}`,
        { parse_mode: "HTML" },
      );
    } else {
      await sendWithMedia(
        ctx,
        MEDIA_KEYS.MATCH_START_BANNER,
        `🏟️ <b>MATCH STARTED!</b>\n\n` +
          `🏏 Striker: ${mention(striker?.name ?? "?", match.currentStrikerId ?? "0")}\n` +
          `🏏 Non-Striker: ${mention(nonStriker?.name ?? "?", match.currentNonStrikerId ?? "0")}\n` +
          `🎯 Bowler: ${mention(bowler.name, playerId)}\n\n` +
          `<b>${match.overs} over${(match.overs ?? 1) > 1 ? "s" : ""} match!</b>`,
        { parse_mode: "HTML" },
      );
    }

    const strikerName = striker?.name ?? "Batter";
    const ballNum = currentBalls + 1;
    await promptBowler(ctx, match.id, playerId, bowler.name, strikerName, match.chatId, ballNum, totalBalls);
  });

  // /endmatch
  bot.command("endmatch", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const allowed = await isAdmin(ctx);
    if (!allowed) {
      await ctx.reply("❌ Only admins can use /endmatch.");
      return;
    }

    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match) {
      await ctx.reply("No active match to end!");
      return;
    }

    clearAllAfk(match.id);
    await updateMatch(match.id, { status: "finished", finishedAt: new Date() });

    await ctx.reply(
      `🛑 <b>Match Force-Ended!</b>\n\n` +
        `${escHtml(match.teamAName ?? "Team A")}: <b>${match.innings1Score}</b>\n` +
        `${escHtml(match.teamBName ?? "Team B")}: <b>${match.innings2Score}</b>\n\n` +
        `<i>Match cancelled — no result recorded.</i>`,
      { parse_mode: "HTML" },
    );
  });

  // Batting button callback (0-6) — team mode
  bot.callbackQuery(/^bat:([0-6])$/, async (ctx) => {
    const match = await getActiveMatch(String(ctx.chat!.id));
    if (!match || match.status !== "live") {
      await ctx.answerCallbackQuery();
      return;
    }

    const userId = String(ctx.from!.id);
    if (match.currentStrikerId !== userId) {
      await ctx.answerCallbackQuery("It's not your turn to bat!");
      return;
    }

    if (match.pendingBowlerNumber === null || match.pendingBowlerNumber === undefined) {
      await ctx.answerCallbackQuery("Bowler hasn't sent their number yet. Wait!");
      return;
    }

    await ctx.answerCallbackQuery();
    clearAfk(match.id, "batter");

    const batterNum = parseInt(ctx.match[1]!);
    const bowlerNum = match.pendingBowlerNumber;
    await runBall(ctx, match, userId, batterNum, bowlerNum);
  });
}

// ── Group text fallback: batter types 0-6 directly in the group chat ─────────
export async function handleGroupBatterInput(ctx: BotContext, num: number): Promise<boolean> {
  if (!ctx.chat || ctx.chat.type === "private") return false;
  const match = await getActiveMatch(String(ctx.chat.id));
  if (!match || match.mode !== "team" || match.status !== "live") return false;

  const userId = String(ctx.from!.id);
  if (match.currentStrikerId !== userId) return false;
  if (match.pendingBowlerNumber === null || match.pendingBowlerNumber === undefined) return false;

  clearAfk(match.id, "batter");
  await runBall(ctx, match, userId, num, match.pendingBowlerNumber);
  return true;
}

// ── STEP 1: Prompt bowler — group message + proactive DM ─────────────────────
export async function promptBowler(
  ctx: BotContext,
  matchId: number,
  bowlerId: string,
  bowlerName: string,
  batterName: string,
  chatId: string,
  ballNum: number,
  totalBalls: number,
) {
  const dmButton = new InlineKeyboard().url(
    "📩 Open DM",
    `https://t.me/${ctx.me.username}?start=bowl`,
  );

  await sendWithMediaToChat(
    ctx.api,
    chatId,
    MEDIA_KEYS.BOWLING_BANNER,
    commentary.bowlingPrompt(mention(bowlerName, bowlerId), mention(batterName, "0"), ballNum, totalBalls, "team"),
    { reply_markup: dmButton, parse_mode: "HTML" },
  );

  try {
    await ctx.api.sendMessage(
      bowlerId,
      commentary.bowlerDmPrompt(batterName, ballNum, totalBalls),
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

      // AFK PENALTY — bowler: +6 to batting team, set status to bowling_order for new bowler
      const inn = m.currentInnings;
      const currentScore = inn === 1 ? m.innings1Score : m.innings2Score;
      const scoreUpdate = inn === 1
        ? { innings1Score: currentScore + 6, status: "bowling_order" }
        : { innings2Score: currentScore + 6, status: "bowling_order" };

      await updateMatch(matchId, scoreUpdate as Partial<typeof m>);

      await ctx.api.sendMessage(
        chatId,
        commentary.afkPenaltyTeam(bowlerName, "bowler", 6),
        { parse_mode: "HTML" },
      ).catch(() => {});

      // Prompt bowling captain to select new bowler
      const bowlingCapId = m.bowlingTeam === "A" ? m.teamACaptainId : m.teamBCaptainId;
      const bowlingCapName = ((m.bowlingTeam === "A" ? m.teamAPlayers : m.teamBPlayers) as PlayerRef[])
        .find((p) => p.id === bowlingCapId)?.name ?? "Captain";

      await ctx.api.sendMessage(
        chatId,
        `🎯 ${mention(bowlingCapName, bowlingCapId ?? "0")} — use /bowling to select the new bowler for remaining balls!`,
        { parse_mode: "HTML" },
      ).catch(() => {});
    },
  );
}

// ── STEP 2: Handle DM from bowler → store + send batting prompt ───────────────
export async function handleDmBowlerInput(
  ctx: BotContext,
  bowlerId: string,
  num: number,
) {
  const rows = await db
    .select()
    .from(matchesTable)
    .where(
      and(
        eq(matchesTable.currentBowlerId, bowlerId),
        eq(matchesTable.status, "live"),
      ),
    )
    .limit(1);

  const match = rows[0];
  if (!match) {
    await ctx.reply("You are not bowling in any active match right now.");
    return;
  }

  clearAfk(match.id, "bowler");

  if (isSpamBlocked(match, num)) {
    await ctx.reply(commentary.spamBlocked(num), { parse_mode: "HTML" });
    return;
  }

  await updateMatch(match.id, { pendingBowlerNumber: num });

  await ctx.reply(
    `🔒 <b>Number locked!</b>\n\nWaiting for the batter in the group...`,
    { parse_mode: "HTML" },
  );

  const currentBalls = match.currentInnings === 1 ? match.innings1Balls : match.innings2Balls;
  const totalBalls = (match.overs ?? 1) * 6;
  const ballNum = currentBalls + 1;

  await sendBattingPromptToGroup(ctx.api, match, match.chatId, ballNum, totalBalls);

  const battingTeamPlayers = (
    match.battingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
  ) as PlayerRef[];
  const striker = battingTeamPlayers.find((p) => p.id === match.currentStrikerId);
  const strikerName = striker?.name ?? "Batter";

  scheduleAfk(
    match.id,
    "batter",
    () => { ctx.api.sendMessage(match.chatId, commentary.afkWarn50(strikerName, "batter"), { parse_mode: "HTML" }).catch(() => {}); },
    () => { ctx.api.sendMessage(match.chatId, commentary.afkWarn30(strikerName), { parse_mode: "HTML" }).catch(() => {}); },
    async () => {
      const row = await db.select().from(matchesTable).where(eq(matchesTable.id, match.id)).limit(1);
      const m = row[0];
      if (!m || m.status !== "live") return;

      // AFK PENALTY — batter: OUT + -6 from batting team score
      const inn = m.currentInnings;
      const currentScore = inn === 1 ? m.innings1Score : m.innings2Score;
      const penaltyScore = Math.max(0, currentScore - 6);
      const currentWkts = inn === 1 ? m.innings1Wickets : m.innings2Wickets;

      const scoreUpdate = inn === 1
        ? { innings1Score: penaltyScore, innings1Wickets: currentWkts + 1, pendingBowlerNumber: null }
        : { innings2Score: penaltyScore, innings2Wickets: currentWkts + 1, pendingBowlerNumber: null };

      await updateMatch(m.id, scoreUpdate as Partial<typeof m>);

      await ctx.api.sendMessage(
        match.chatId,
        commentary.afkPenaltyTeam(strikerName, "batter", 6),
        { parse_mode: "HTML" },
      ).catch(() => {});

      // Bring in next batter
      const freshRow = await db.select().from(matchesTable).where(eq(matchesTable.id, m.id)).limit(1);
      const freshMatch = freshRow[0];
      if (freshMatch) {
        await handleWicket(ctx, freshMatch as NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>, freshMatch.currentInnings === 1 ? freshMatch.innings1Balls : freshMatch.innings2Balls);
      }
    },
  );
}

// ── Helper: send batting prompt to group chat ─────────────────────────────────
async function sendBattingPromptToGroup(
  api: import("grammy").Api,
  match: typeof matchesTable.$inferSelect,
  chatId: string,
  ballNum: number,
  totalBalls: number,
) {
  const battingTeamPlayers = (
    match.battingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
  ) as PlayerRef[];
  const striker = battingTeamPlayers.find((p) => p.id === match.currentStrikerId);
  const strikerName = striker?.name ?? "Batter";

  const batKb = new InlineKeyboard();
  [0, 1, 2, 3, 4, 5, 6].forEach((n) => batKb.text(String(n), `bat:${n}`));

  await sendWithMediaToChat(
    api,
    chatId,
    MEDIA_KEYS.BATTING_BANNER,
    commentary.battingPrompt(mention(strikerName, match.currentStrikerId ?? "0"), ballNum, totalBalls, "team"),
    { parse_mode: "HTML", reply_markup: batKb },
  );
}

// ── STEP 3: Process ball result ────────────────────────────────────────────────
async function runBall(
  ctx: BotContext,
  match: NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>,
  batterId: string,
  batterNum: number,
  bowlerNum: number,
) {
  const battingTeamPlayers = (
    match.battingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
  ) as PlayerRef[];
  const bowlingTeamPlayers = (
    match.bowlingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
  ) as PlayerRef[];

  const batter = battingTeamPlayers.find((p) => p.id === batterId);
  const bowler = bowlingTeamPlayers.find((p) => p.id === match.currentBowlerId);

  clearAllAfk(match.id);

  const { result, updatedMatch } = await processBall(
    match,
    batterId,
    batter?.name ?? "Batter",
    match.currentBowlerId!,
    batterNum,
    bowlerNum,
  );

  await updateMatch(match.id, { pendingBowlerNumber: null });

  // ── REVEAL: Only show batter's number, NOT bowler's ──────────────────────
  const revealLine = `🏏 ${mention(batter?.name ?? "Batter", batterId)} played <b>${batterNum}</b>`;

  const runMediaKey =
    result.isWicket
      ? MEDIA_KEYS.WICKET
      : ([
          MEDIA_KEYS.RUN_0, MEDIA_KEYS.RUN_1, MEDIA_KEYS.RUN_2,
          MEDIA_KEYS.RUN_3, MEDIA_KEYS.RUN_4, MEDIA_KEYS.RUN_5, MEDIA_KEYS.RUN_6,
        ][result.runs] ?? MEDIA_KEYS.RUN_0);

  const resultCommentary = result.isWicket
    ? commentary.wicket(batter?.name ?? "Batter", bowler?.name ?? "Bowler")
    : commentary.runs(result.runs);

  await sendWithMedia(ctx, runMediaKey, `${revealLine}\n\n${resultCommentary}`, { parse_mode: "HTML" });

  // Hat-trick
  if (result.hatTrick) {
    await sendWithMedia(ctx, MEDIA_KEYS.HAT_TRICK, commentary.hatTrick(bowler?.name ?? "Bowler"), { parse_mode: "HTML" });
    const { db: database } = await import("@workspace/db");
    const { playersTable: pt } = await import("@workspace/db");
    const { eq: eqFn, sql: sqlFn } = await import("drizzle-orm");
    await database.update(pt).set({ hatTricks: sqlFn`hat_tricks + 1` } as Record<string, unknown>).where(eqFn(pt.telegramId, match.currentBowlerId!));
  }

  // Milestones
  if (result.milestone) {
    const msKey = result.milestone === "50" ? MEDIA_KEYS.MILESTONE_50 : result.milestone === "100" ? MEDIA_KEYS.MILESTONE_100 : MEDIA_KEYS.MILESTONE_200;
    const msText = result.milestone === "50" ? commentary.milestone50(batter?.name ?? "Batter") : result.milestone === "100" ? commentary.milestone100(batter?.name ?? "Batter") : commentary.milestone200(batter?.name ?? "Batter");
    await sendWithMedia(ctx, msKey, msText, { parse_mode: "HTML" });
  }

  // Score line
  const inn = updatedMatch.currentInnings;
  const score = inn === 1 ? updatedMatch.innings1Score : updatedMatch.innings2Score;
  const wkts = inn === 1 ? updatedMatch.innings1Wickets : updatedMatch.innings2Wickets;
  const balls = inn === 1 ? updatedMatch.innings1Balls : updatedMatch.innings2Balls;
  const over = Math.floor(balls / 6);
  const ballInOver = balls % 6;
  let scoreLine = `📊 <b>${score}/${wkts}</b> (${over}.${ballInOver} ov)`;
  if (inn === 2 && updatedMatch.target) {
    const need = updatedMatch.target - score;
    const ballsLeft = ((updatedMatch.overs ?? 1) * 6) - balls;
    scoreLine += `  ·  Need <b>${need}</b> off <b>${ballsLeft}</b> balls`;
  }
  await ctx.reply(scoreLine, { parse_mode: "HTML" });

  // Over summary (at end of each over)
  if (balls > 0 && ballInOver === 0) {
    const strikerName = batter?.name ?? "Batter";
    const bowlerName = bowler?.name ?? "Bowler";
    await ctx.reply(
      commentary.overSummary(over, result.runs, result.isWicket ? 1 : 0, strikerName, bowlerName),
      { parse_mode: "HTML" },
    );
  }

  // Match over
  if (result.matchOver) {
    await handleMatchOver(ctx, updatedMatch);
    return;
  }

  // Innings over (innings 1)
  if (result.inningsOver) {
    await handleInningsChange(ctx, updatedMatch);
    return;
  }

  // Wicket — bring next batter
  if (result.isWicket) {
    await handleWicket(ctx, updatedMatch, balls);
    return;
  }

  // Strike rotation: odd runs (1,3,5) rotate mid-over
  const totalBalls = (updatedMatch.overs ?? 1) * 6;
  let nextStrikerId = updatedMatch.currentStrikerId!;
  let nextNonStrikerId = updatedMatch.currentNonStrikerId!;

  if (result.runs % 2 === 1 && nextStrikerId && nextNonStrikerId) {
    [nextStrikerId, nextNonStrikerId] = [nextNonStrikerId, nextStrikerId];
  }

  if (balls % 6 === 0 && balls > 0 && nextStrikerId && nextNonStrikerId) {
    [nextStrikerId, nextNonStrikerId] = [nextNonStrikerId, nextStrikerId];
    const rotatedStriker = battingTeamPlayers.find((p) => p.id === nextStrikerId);
    await updateMatch(match.id, {
      currentStrikerId: nextStrikerId,
      currentNonStrikerId: nextNonStrikerId,
    });
    await ctx.reply(
      `🔄 <b>Over ${over} complete!</b> ${mention(rotatedStriker?.name ?? "Batter", nextStrikerId)} is now on strike.`,
      { parse_mode: "HTML" },
    );
  } else if (result.runs % 2 === 1 && updatedMatch.currentStrikerId !== nextStrikerId) {
    const rotatedStriker = battingTeamPlayers.find((p) => p.id === nextStrikerId);
    await updateMatch(match.id, {
      currentStrikerId: nextStrikerId,
      currentNonStrikerId: nextNonStrikerId,
    });
    await ctx.reply(
      `🔀 Strike rotates! ${mention(rotatedStriker?.name ?? "Batter", nextStrikerId)} on strike (${result.runs} run${result.runs !== 1 ? "s" : ""})`,
      { parse_mode: "HTML" },
    );
  }

  const freshMatch = await getActiveMatch(match.chatId);
  const freshStriker = battingTeamPlayers.find((p) => p.id === (freshMatch?.currentStrikerId ?? nextStrikerId));
  const nextStrikerName = freshStriker?.name ?? batter?.name ?? "Batter";

  const nextBallNum = balls + 1;
  await promptBowler(ctx, updatedMatch.id, match.currentBowlerId!, bowler?.name ?? "Bowler", nextStrikerName, match.chatId, nextBallNum, totalBalls);
}

// ── Wicket: bring in next batter ─────────────────────────────────────────────
async function handleWicket(
  ctx: BotContext,
  match: NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>,
  currentBalls: number,
) {
  const battingTeam = match.battingTeam as "A" | "B";
  const order = (
    battingTeam === "A" ? match.teamABattingOrder : match.teamBBattingOrder
  ) as PlayerRef[];
  const idx = battingTeam === "A" ? match.teamABattingIndex : match.teamBBattingIndex;
  const nextIdx = idx + 1;
  const next = order[nextIdx];

  const bowlingTeamPlayers = (
    match.bowlingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
  ) as PlayerRef[];
  const bowler = bowlingTeamPlayers.find((p) => p.id === match.currentBowlerId);

  if (!next) {
    await ctx.reply(`💀 <b>ALL OUT!</b> No batters left!`, { parse_mode: "HTML" });
    await handleInningsChange(ctx, match);
    return;
  }

  const idxUpdate =
    battingTeam === "A"
      ? { currentStrikerId: next.id, teamABattingIndex: nextIdx }
      : { currentStrikerId: next.id, teamBBattingIndex: nextIdx };

  await updateMatch(match.id, idxUpdate);

  await ctx.reply(
    `🆕 <b>New Batter!</b>\n\n` +
      `🏏 ${mention(next.name, next.id)} walks to the crease!\n` +
      `🎯 Bowler: ${mention(bowler?.name ?? "Bowler", match.currentBowlerId!)}\n\n` +
      `<i>Play ball!</i>`,
    { parse_mode: "HTML" },
  );

  const totalBalls = (match.overs ?? 1) * 6;
  const nextBallNum = currentBalls + 1;
  await promptBowler(ctx, match.id, match.currentBowlerId!, bowler?.name ?? "Bowler", next.name, match.chatId, nextBallNum, totalBalls);
}

// ── Innings change (innings 1 → innings 2) ────────────────────────────────────
async function handleInningsChange(
  ctx: BotContext,
  match: NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>,
) {
  if (match.currentInnings === 2) {
    await handleMatchOver(ctx, match);
    return;
  }

  const newBattingTeam = match.bowlingTeam as "A" | "B";
  const newBowlingTeam = match.battingTeam as "A" | "B";
  const target = match.innings1Score + 1;

  const newBattingPlayers = (
    newBattingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
  ) as PlayerRef[];
  const newBattingCapId =
    newBattingTeam === "A" ? match.teamACaptainId : match.teamBCaptainId;
  const newBowlingCapId =
    newBowlingTeam === "A" ? match.teamACaptainId : match.teamBCaptainId;
  const newBowlingTeamPlayers = (
    (newBowlingTeam === "A" ? match.teamAPlayers : match.teamBPlayers) as PlayerRef[]
  );
  const newBowlingCapName = newBowlingTeamPlayers.find((p) => p.id === newBowlingCapId)?.name ?? "Captain";

  await updateMatch(match.id, {
    currentInnings: 2,
    battingTeam: newBattingTeam,
    bowlingTeam: newBowlingTeam,
    currentStrikerId: null,
    currentNonStrikerId: null,
    currentBowlerId: null,
    pendingBowlerNumber: null,
    status: "batting_order",
    target,
    [newBattingTeam === "A" ? "teamABattingIndex" : "teamBBattingIndex"]: 0,
  });

  const newBattingCapName =
    newBattingPlayers.find((p) => p.id === newBattingCapId)?.name ?? "Captain";
  const teamName =
    newBattingTeam === "A" ? (match.teamAName ?? "Team A") : (match.teamBName ?? "Team B");

  await sendWithMedia(
    ctx,
    MEDIA_KEYS.INNINGS_BREAK_BANNER,
    commentary.inningsBreak(teamName, target),
    { parse_mode: "HTML" },
  );

  await ctx.reply(
    `🏏 ${mention(newBattingCapName, newBattingCapId!)} — set batting order:\n/batting 1 (Striker)\n/batting 2 (Non-Striker)`,
    { parse_mode: "HTML" },
  );
}

// ── Match over ────────────────────────────────────────────────────────────────
async function handleMatchOver(
  ctx: BotContext,
  match: NonNullable<Awaited<ReturnType<typeof getActiveMatch>>>,
) {
  const scoreA = match.innings1Score;
  const scoreB = match.innings2Score;
  const wktsA = match.innings1Wickets;
  const wktsB = match.innings2Wickets;
  const ballsA = match.innings1Balls;
  const ballsB = match.innings2Balls;
  const teamA = match.teamAName ?? "Team A";
  const teamB = match.teamBName ?? "Team B";
  const overs = match.overs ?? 1;

  let winnerId = "";
  let winnerName = "";
  let winMsg = "";

  if (scoreA > scoreB) {
    winnerId = match.teamACaptainId ?? "";
    winnerName = teamA;
    winMsg = commentary.win(teamA, `by ${scoreA - scoreB} runs`);
  } else if (scoreB > scoreA) {
    winnerId = match.teamBCaptainId ?? "";
    winnerName = teamB;
    const ballsLeft = (overs * 6) - ballsB;
    const wktsLeft = (match.teamBWicketsLeft ?? 10) - wktsB;
    winMsg = commentary.win(teamB, `by ${wktsLeft} wicket${wktsLeft !== 1 ? "s" : ""} (${ballsLeft} balls remaining)`);
  } else {
    winMsg = commentary.tie();
  }

  await updateMatch(match.id, {
    status: "finished",
    finishedAt: new Date(),
    winnerId,
    winnerName,
  });

  clearAllAfk(match.id);

  await sendWithMedia(ctx, MEDIA_KEYS.VICTORY_BANNER, winMsg, { parse_mode: "HTML" });

  const ovA = `${Math.floor(ballsA / 6)}.${ballsA % 6}`;
  const ovB = `${Math.floor(ballsB / 6)}.${ballsB % 6}`;

  // Get all players for stats
  const teamAPlayers = (match.teamAPlayers as PlayerRef[]);
  const teamBPlayers = (match.teamBPlayers as PlayerRef[]);

  // Collect ball-by-ball stats from DB
  const ballRows = await db.select().from(ballsTable).where(eq(ballsTable.matchId, match.id));

  const statsMap = new Map<string, { runs: number; wickets: number; balls: number; ballsBowled: number; runsConceded: number; sixes: number; fours: number }>();
  const initStat = () => ({ runs: 0, wickets: 0, balls: 0, ballsBowled: 0, runsConceded: 0, sixes: 0, fours: 0 });

  for (const ball of ballRows) {
    const b = statsMap.get(ball.batterId) ?? initStat();
    b.runs += ball.runs;
    b.balls += 1;
    if (ball.runs === 6) b.sixes++;
    if (ball.runs === 4) b.fours++;
    statsMap.set(ball.batterId, b);

    const bwl = statsMap.get(ball.bowlerId) ?? initStat();
    bwl.ballsBowled += 1;
    bwl.runsConceded += ball.runs;
    if (ball.isWicket) bwl.wickets++;
    statsMap.set(ball.bowlerId, bwl);
  }

  // Determine top batter (for OmniDAi summary)
  let topBatterName = "—";
  let topBatterRuns = 0;
  let topBowlerName = "—";
  let topBowlerWkts = 0;
  for (const [id, stat] of statsMap) {
    const allP = [...teamAPlayers, ...teamBPlayers];
    const p = allP.find((x) => x.id === id);
    if (!p) continue;
    if (stat.runs > topBatterRuns) { topBatterRuns = stat.runs; topBatterName = p.name; }
    if (stat.wickets > topBowlerWkts) { topBowlerWkts = stat.wickets; topBowlerName = p.name; }
  }

  // OmniDAi summary
  await ctx.reply(
    commentary.aiMatchSummary(
      teamA, scoreA, wktsA, teamB, scoreB, wktsB,
      winnerName, winnerName === teamA ? `by ${scoreA - scoreB} runs` : `by wickets`,
      topBatterName, topBatterRuns, topBowlerName, topBowlerWkts, overs,
    ),
    { parse_mode: "HTML" },
  );

  // Record player stats
  const allPlayers = [...teamAPlayers, ...teamBPlayers];
  for (const p of allPlayers) {
    const stat = statsMap.get(p.id) ?? initStat();
    const won = p.id === winnerId || (winnerId === "" ? false : [...(match.battingTeam === "A" ? teamAPlayers : teamBPlayers)].some((x) => x.id === p.id) && winnerName === match.teamAName);
    const duck = stat.runs === 0 && stat.balls > 0;
    await recordPlayerMatchResult({
      telegramId: p.id,
      runs: stat.runs,
      wickets: stat.wickets,
      ballsFaced: stat.balls,
      ballsBowled: stat.ballsBowled,
      runsConceded: stat.runsConceded,
      sixes: stat.sixes,
      fours: stat.fours,
      won,
      duck,
    }).catch(() => {});
    await updateBestBowling(p.id, stat.wickets, stat.runsConceded).catch(() => {});
  }

  await ctx.reply(
    `📋 <b>FINAL SCORE</b>\n\n` +
    `🔵 <b>${escHtml(teamA)}</b>: ${scoreA}/${wktsA} (${ovA} ov)\n` +
    `🔴 <b>${escHtml(teamB)}</b>: ${scoreB}/${wktsB} (${ovB} ov)\n\n` +
    `<i>GG! Use /start for a new match.</i>`,
    { parse_mode: "HTML" },
  );
}
