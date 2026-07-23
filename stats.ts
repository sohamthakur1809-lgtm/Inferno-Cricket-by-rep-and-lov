import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../context.js";
import {
  getPlayer,
  getTopRunScorers,
  getTopWicketTakers,
  getTopWinners,
  getTopSixHitters,
  getTopStrikeRates,
  getTopEconomyBowlers,
  getTopHatTrickTakers,
  getTopWinStreaks,
  getRecords,
  upsertPlayer,
  getActiveMatch,
} from "../utils/db.js";
import { formatUserInfo, escHtml, strikeRate, economy } from "../utils/format.js";

export function registerStatsHandlers(bot: Bot<BotContext>) {
  // /userinfo — player profile
  bot.command("userinfo", async (ctx) => {
    const user = ctx.from!;
    await upsertPlayer(String(user.id), user.first_name, user.username);
    const p = await getPlayer(String(user.id));
    if (!p) {
      await ctx.reply("No stats found. Play a match first!");
      return;
    }
    await ctx.reply(formatUserInfo(p), { parse_mode: "HTML" });
  });

  // /user_ranks
  bot.command("user_ranks", async (ctx) => {
    await sendRanksPage(ctx, "runs");
  });

  // /grank — global rankings with category buttons
  bot.command("grank", async (ctx) => {
    await sendRanksPage(ctx, "runs");
  });

  // Category buttons for rankings
  bot.callbackQuery(/^rank:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const category = ctx.match[1]!;
    await sendRanksPage(ctx, category, true);
  });

  // /records
  bot.command("records", async (ctx) => {
    const r = await getRecords();
    let msg = `📊 <b>ALL-TIME RECORDS</b>\n\n`;

    if (r.topRun) msg += `🏆 Highest Score: <b>${r.topRun.highestScore}</b> by ${escHtml(r.topRun.firstName)}\n`;
    if (r.topWickets) msg += `🎯 Most Wickets: <b>${r.topWickets.totalWickets}</b> by ${escHtml(r.topWickets.firstName)}\n`;
    if (r.topSixes) msg += `6️⃣ Most Sixes: <b>${r.topSixes.totalSixes}</b> by ${escHtml(r.topSixes.firstName)}\n`;
    if (r.topStreak) msg += `🔥 Longest Win Streak: <b>${r.topStreak.longestWinStreak}</b> by ${escHtml(r.topStreak.firstName)}\n`;
    if (r.highTeam) msg += `\n📋 Highest Team Score: <b>${r.highTeam.innings1Score}</b>\n`;

    await ctx.reply(msg, { parse_mode: "HTML" });
  });

  // /score — live score
  bot.command("score", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.status !== "live") {
      await ctx.reply("No live match in progress.");
      return;
    }
    const { formatScore } = await import("../utils/format.js");
    await ctx.reply(formatScore(match), { parse_mode: "HTML" });
  });

  // /halloffame
  bot.command("halloffame", async (ctx) => {
    const [runs, wickets, sixes, wins, hatTricks] = await Promise.all([
      getTopRunScorers(1),
      getTopWicketTakers(1),
      getTopSixHitters(1),
      getTopWinners(1),
      getTopHatTrickTakers(1),
    ]);

    let msg = `🏛️ <b>HALL OF FAME</b>\n<i>CRIC INFERNO Legends</i>\n\n`;
    if (runs[0]) msg += `👑 <b>Run King:</b> ${escHtml(runs[0].firstName)} — ${runs[0].totalRuns} runs\n`;
    if (wickets[0]) msg += `💀 <b>Wicket Machine:</b> ${escHtml(wickets[0].firstName)} — ${wickets[0].totalWickets} wickets\n`;
    if (sixes[0]) msg += `💥 <b>Six Hitter:</b> ${escHtml(sixes[0].firstName)} — ${sixes[0].totalSixes} sixes\n`;
    if (wins[0]) msg += `🏆 <b>Champion:</b> ${escHtml(wins[0].firstName)} — ${wins[0].wins} wins\n`;
    if (hatTricks[0]) msg += `🎩 <b>Hat-trick Hero:</b> ${escHtml(hatTricks[0].firstName)} — ${hatTricks[0].hatTricks} hat-tricks\n`;

    await ctx.reply(msg, { parse_mode: "HTML" });
  });
}

// ── Rankings page helper ──────────────────────────────────────────────────────
async function sendRanksPage(ctx: BotContext, category: string, edit = false) {
  const kb = new InlineKeyboard()
    .text("🏏 Runs", "rank:runs").text("🎯 Wickets", "rank:wickets").row()
    .text("💥 Sixes", "rank:sixes").text("🏆 Wins", "rank:wins").row()
    .text("⚡ Strike Rate", "rank:sr").text("💨 Economy", "rank:eco").row()
    .text("🎩 Hat-Tricks", "rank:hattricks").text("🔥 Win Streak", "rank:streak");

  let title = "";
  let list = "";

  if (category === "runs") {
    title = "🏆 TOP RUN SCORERS";
    const players = await getTopRunScorers(10);
    list = players.map((p, i) => `${medal(i)}${escHtml(p.firstName)} — <b>${p.totalRuns}</b> runs (HS: ${p.highestScore})`).join("\n");
  } else if (category === "wickets") {
    title = "🎯 TOP WICKET TAKERS";
    const players = await getTopWicketTakers(10);
    list = players.map((p, i) => `${medal(i)}${escHtml(p.firstName)} — <b>${p.totalWickets}</b> wkts (Best: ${p.bestBowlingWickets}/${p.bestBowlingRuns})`).join("\n");
  } else if (category === "sixes") {
    title = "💥 MOST SIXES";
    const players = await getTopSixHitters(10);
    list = players.map((p, i) => `${medal(i)}${escHtml(p.firstName)} — <b>${p.totalSixes}</b> sixes`).join("\n");
  } else if (category === "wins") {
    title = "🏅 MOST WINS";
    const players = await getTopWinners(10);
    list = players.map((p, i) => `${medal(i)}${escHtml(p.firstName)} — <b>${p.wins}</b> wins (${p.matchesPlayed} matches)`).join("\n");
  } else if (category === "sr") {
    title = "⚡ TOP STRIKE RATES";
    const players = await getTopStrikeRates(10);
    list = players.map((p, i) => `${medal(i)}${escHtml(p.firstName)} — <b>SR ${strikeRate(p.totalRuns, p.totalBallsFaced)}</b>`).join("\n");
    if (!list) list = "Min 30 balls faced required";
  } else if (category === "eco") {
    title = "💨 BEST ECONOMY";
    const players = await getTopEconomyBowlers(10);
    list = players.map((p, i) => `${medal(i)}${escHtml(p.firstName)} — <b>Eco ${economy(p.totalRunsConceded, p.totalBallsBowled)}</b>`).join("\n");
    if (!list) list = "Min 30 balls bowled required";
  } else if (category === "hattricks") {
    title = "🎩 HAT-TRICK HEROES";
    const players = await getTopHatTrickTakers(10);
    list = players.map((p, i) => `${medal(i)}${escHtml(p.firstName)} — <b>${p.hatTricks}</b> hat-tricks`).join("\n");
    if (!list) list = "No hat-tricks recorded yet";
  } else if (category === "streak") {
    title = "🔥 WIN STREAKS";
    const players = await getTopWinStreaks(10);
    list = players.map((p, i) => `${medal(i)}${escHtml(p.firstName)} — <b>${p.longestWinStreak}</b> wins streak`).join("\n");
  }

  const msg = `🌍 <b>GLOBAL RANKINGS</b>\n\n${title}\n\n${list || "No data yet"}`;

  if (edit) {
    try {
      await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
      return;
    } catch { /* fall through */ }
  }
  await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
}

function medal(i: number): string {
  if (i === 0) return "🥇 ";
  if (i === 1) return "🥈 ";
  if (i === 2) return "🥉 ";
  return `${i + 1}. `;
}
