import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../context.js";
import { getActiveMatch, updateMatch } from "../utils/db.js";
import { sendWithMedia, MEDIA_KEYS } from "../utils/media.js";
import { mention, escHtml } from "../utils/format.js";

export function registerTossHandlers(bot: Bot<BotContext>) {
  // /toss — host triggers toss
  bot.command("toss", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") return;
    if (match.hostId !== String(ctx.from!.id)) {
      await ctx.reply("Only the host can start the toss.");
      return;
    }
    if (!match.teamACaptainId || !match.teamBCaptainId) {
      await ctx.reply("Both captains must be selected first. Use /choose_cap");
      return;
    }
    if (!match.overs) {
      await ctx.reply("Please set overs first. Use /set_overs");
      return;
    }
    await startToss(ctx, match);
  });

  // Heads / Tails
  bot.callbackQuery(/^toss:call:(heads|tails)$/, async (ctx) => {
    const match = await getActiveMatch(String(ctx.chat!.id));
    if (!match || match.status !== "toss") {
      await ctx.answerCallbackQuery();
      return;
    }

    const userId = String(ctx.from!.id);
    if (match.pendingTossCallerId !== userId) {
      await ctx.answerCallbackQuery("It's not your turn to call!");
      return;
    }

    await ctx.answerCallbackQuery();

    const call = ctx.match[1] as "heads" | "tails";
    const flip = Math.random() < 0.5 ? "heads" : "tails";
    const won = call === flip;

    const teamAPlayers = (match.teamAPlayers as { id: string; name: string }[]);
    const teamBPlayers = (match.teamBPlayers as { id: string; name: string }[]);
    const callerTeam = teamAPlayers.find((p) => p.id === userId) ? "A" : "B";
    const winnerTeam = won ? callerTeam : callerTeam === "A" ? "B" : "A";
    const winnerCapId = winnerTeam === "A" ? match.teamACaptainId! : match.teamBCaptainId!;
    const winnerCapName = (winnerTeam === "A" ? teamAPlayers : teamBPlayers).find(
      (p) => p.id === winnerCapId,
    )?.name ?? "Captain";

    await updateMatch(match.id, {
      tossWinnerId: winnerCapId,
      status: "toss_won",
    });

    const kb = new InlineKeyboard()
      .text("🏏 Bat First", "toss:bat")
      .text("🎯 Bowl First", "toss:bowl");

    // Always send a fresh message — editing can fail if the original message
    // is a photo/video (must use editMessageCaption, not editMessageText).
    await ctx.reply(
      `🪙 <b>Toss Result</b>\n\nFlip: <b>${flip.toUpperCase()}</b>\n\n` +
        `${won ? "✅" : "❌"} ${mention(ctx.from!.first_name, userId)} called <b>${call}</b>\n\n` +
        `🏆 ${mention(winnerCapName, winnerCapId)} wins the toss! Choose:`,
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  // Bat / Bowl choice
  bot.callbackQuery(/^toss:(bat|bowl)$/, async (ctx) => {
    const match = await getActiveMatch(String(ctx.chat!.id));
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }

    const userId = String(ctx.from!.id);
    if (match.tossWinnerId !== userId) {
      await ctx.answerCallbackQuery("Only the toss winner can choose!");
      return;
    }

    await ctx.answerCallbackQuery();

    const choice = ctx.match[1] as "bat" | "bowl";
    const teamAPlayers = (match.teamAPlayers as { id: string; name: string }[]);
    const winnerTeam = teamAPlayers.find((p) => p.id === userId) ? "A" : "B";
    const battingTeam = choice === "bat" ? winnerTeam : winnerTeam === "A" ? "B" : "A";
    const bowlingTeam = battingTeam === "A" ? "B" : "A";

    await updateMatch(match.id, {
      tossChoice: choice,
      battingTeam,
      bowlingTeam,
      status: "spam_free",
      teamAWicketsLeft: teamAPlayers.length - 1,
      teamBWicketsLeft: (match.teamBPlayers as []).length - 1,
      teamABattingOrder: teamAPlayers,
      teamBBattingOrder: match.teamBPlayers as { id: string; name: string }[],
    });

    const battingTeamName = battingTeam === "A" ? (match.teamAName ?? "Team A") : (match.teamBName ?? "Team B");

    // Ask about spam-free mode
    const kb = new InlineKeyboard()
      .text("✅ Allow", "spamfree:yes")
      .text("❌ Disable", "spamfree:no");

    await ctx.reply(
      `🏏 <b>${escHtml(battingTeamName)}</b> will bat first!\n\n` +
        `Host: Enable Spam-Free Bowling?\n<i>(Bowler can't use same number 3 times in a row)</i>`,
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  // Spam-free setting
  bot.callbackQuery("spamfree:yes", handleSpamFree(true));
  bot.callbackQuery("spamfree:no", handleSpamFree(false));
}

export async function startToss(ctx: BotContext, match: Awaited<ReturnType<typeof getActiveMatch>>) {
  if (!match) return;

  // Pick random captain to call
  const callerCapId =
    Math.random() < 0.5 ? match.teamACaptainId! : match.teamBCaptainId!;
  const teamAPlayers = (match.teamAPlayers as { id: string; name: string }[]);
  const teamBPlayers = (match.teamBPlayers as { id: string; name: string }[]);
  const callerName =
    [...teamAPlayers, ...teamBPlayers].find((p) => p.id === callerCapId)?.name ?? "Captain";

  await updateMatch(match.id, {
    status: "toss",
    pendingTossCallerId: callerCapId,
  });

  const kb = new InlineKeyboard().text("Heads", "toss:call:heads").text("Tails", "toss:call:tails");

  await sendWithMedia(
    ctx,
    MEDIA_KEYS.TOSS_BANNER,
    `🪙 <b>Toss Time</b>\n\n${mention(callerName, callerCapId)} — it's your call!`,
    { parse_mode: "HTML", reply_markup: kb },
  );
}

function handleSpamFree(enable: boolean) {
  return async (ctx: BotContext) => {
    const match = await getActiveMatch(String(ctx.chat!.id));
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (match.hostId !== String(ctx.from!.id)) {
      await ctx.answerCallbackQuery("Only the host can decide this!");
      return;
    }

    await ctx.answerCallbackQuery();

    await updateMatch(match.id, {
      spamFreeMode: enable,
      status: "batting_order",
    });

    const battingCap =
      match.battingTeam === "A" ? match.teamACaptainId : match.teamBCaptainId;
    const bowlingCap =
      match.bowlingTeam === "A" ? match.teamACaptainId : match.teamBCaptainId;
    const battingTeamPlayers = (
      match.battingTeam === "A" ? match.teamAPlayers : match.teamBPlayers
    ) as { id: string; name: string }[];
    const battingCapName = battingTeamPlayers.find((p) => p.id === battingCap)?.name ?? "Captain";

    await ctx.reply(
      `${enable ? "✅" : "❌"} Spam-Free mode ${enable ? "enabled" : "disabled"}.\n\n` +
        `${mention(battingCapName, battingCap!)} — set your batting order:\n` +
        `/batting 1 — Select Striker\n/batting 2 — Select Non-Striker`,
      { parse_mode: "HTML" },
    );
  };
}
