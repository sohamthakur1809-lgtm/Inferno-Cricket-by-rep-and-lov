import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { BotContext } from "../context.js";
import {
  appendMedia,
  clearMedia,
  getMediaCount,
  getSetting,
  setSetting,
  getBotStats,
  getAllActiveMatches,
  updateMatch,
  searchPlayer,
  banPlayer,
  unbanPlayer,
  resetPlayerStats,
  getAllGroups,
  getPlayer,
} from "../utils/db.js";
import { isBotAdmin } from "../utils/admin.js";
import { MEDIA_KEYS } from "../utils/media.js";
import { escHtml, mention } from "../utils/format.js";
import os from "os";
import { db } from "@workspace/db";
import { matchesTable } from "@workspace/db";
import { ne } from "drizzle-orm";
import { exec } from "child_process";
import { createReadStream, existsSync } from "fs";
import { promisify } from "util";
import https from "https";

const execAsync = promisify(exec);

export const MEDIA_LABELS: Record<string, string> = {
  [MEDIA_KEYS.START_BANNER]: "🏠 Start Banner",
  [MEDIA_KEYS.DM_START_BANNER]: "📩 DM Start Banner",
  [MEDIA_KEYS.SOLO_BANNER]: "⚔️ Solo Banner",
  [MEDIA_KEYS.TEAM_BANNER]: "👥 Team Banner",
  [MEDIA_KEYS.JOIN_TEAM_BANNER]: "🔵🔴 Join Team Banner",
  [MEDIA_KEYS.CAPTAIN_BANNER]: "👑 Captain Banner",
  [MEDIA_KEYS.TOSS_BANNER]: "🪙 Toss Banner",
  [MEDIA_KEYS.BATTING_BANNER]: "🏏 Batting Banner",
  [MEDIA_KEYS.BOWLING_BANNER]: "🎯 Bowling Banner",
  [MEDIA_KEYS.MATCH_START_BANNER]: "🏟 Match Start Banner",
  [MEDIA_KEYS.INNINGS_BREAK_BANNER]: "☕ Innings Break Banner",
  [MEDIA_KEYS.VICTORY_BANNER]: "🏆 Victory Banner",
  [MEDIA_KEYS.RUN_0]: "⚫ 0 Run (Dot Ball)",
  [MEDIA_KEYS.RUN_1]: "1️⃣ 1 Run",
  [MEDIA_KEYS.RUN_2]: "2️⃣ 2 Runs",
  [MEDIA_KEYS.RUN_3]: "3️⃣ 3 Runs",
  [MEDIA_KEYS.RUN_4]: "4️⃣ 4 Runs (Boundary)",
  [MEDIA_KEYS.RUN_5]: "5️⃣ 5 Runs",
  [MEDIA_KEYS.RUN_6]: "6️⃣ 6 Runs (SIX!)",
  [MEDIA_KEYS.WICKET]: "💀 Wicket / OUT",
  [MEDIA_KEYS.MILESTONE_25]: "🎯 25 Runs Milestone",
  [MEDIA_KEYS.MILESTONE_50]: "🥳 50 Runs Milestone",
  [MEDIA_KEYS.MILESTONE_75]: "💪 75 Runs Milestone",
  [MEDIA_KEYS.MILESTONE_100]: "💯 100 Runs Century",
  [MEDIA_KEYS.MILESTONE_150]: "🌟 150 Runs Milestone",
  [MEDIA_KEYS.MILESTONE_200]: "🚀 200 Runs Double Century",
  [MEDIA_KEYS.HAT_TRICK]: "🎩 Hat-Trick",
  [MEDIA_KEYS.FIVE_WICKETS]: "🔥 Five Wickets",
  [MEDIA_KEYS.PLAYER_OF_MATCH]: "⭐ Player of the Match",
};

const pendingMediaUpload: Record<string, string> = {};
const pendingUserSearch: Record<string, string> = {};
const pendingBroadcast: Record<string, string> = {};
const botStartTime = Date.now();

export function registerAdminHandlers(bot: Bot<BotContext>) {
  // /adminpanel
  bot.command("adminpanel", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) {
      await ctx.reply("❌ Access denied.");
      return;
    }
    await sendAdminPanel(ctx);
  });

  // /stats
  bot.command("stats", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    await sendDashboard(ctx);
  });

  // /broadcast
  bot.command("broadcast", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    const text = ctx.message!.text.replace("/broadcast", "").trim();
    if (!text) {
      await ctx.reply("Usage: /broadcast <message>");
      return;
    }
    await doBroadcast(ctx, text);
  });

  // /media
  bot.command("media", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) {
      await ctx.reply("❌ Access denied.");
      return;
    }
    if (ctx.chat.type !== "private") {
      await ctx.reply("📩 Media manager works only in DM.");
      return;
    }
    await sendMediaManager(ctx);
  });

  // /setlink
  bot.command("setlink", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    const link = ctx.message!.text.replace("/setlink", "").trim();
    if (!link) {
      await ctx.reply("Usage: /setlink <telegram_link>\nExample: /setlink https://t.me/InfernoPlayzone");
      return;
    }
    await setSetting("playzone_link", link);
    await ctx.reply(`✅ Playzone link updated:\n${link}`);
  });

  // /setdeploy — set Render deploy hook URL
  bot.command("setdeploy", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    const url = ctx.message!.text.replace("/setdeploy", "").trim();
    if (!url || !url.startsWith("https://")) {
      await ctx.reply("Usage: /setdeploy <render_deploy_hook_url>\nGet from Render → Service → Settings → Deploy Hook");
      return;
    }
    await setSetting("render_deploy_hook", url);
    await ctx.reply("✅ Render deploy hook saved!\n\nUse the Deploy button in /adminpanel to trigger a deploy.");
  });

  // /exportcode — ZIP bot source and send
  bot.command("exportcode", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    if (ctx.chat.type !== "private") {
      await ctx.reply("📩 Use /exportcode in DM.");
      return;
    }
    await ctx.reply("📦 Packaging source code...");
    try {
      const zipPath = "/tmp/cric-inferno-bot.zip";
      await execAsync(
        `cd /home/runner/workspace && zip -r ${zipPath} artifacts/api-server/src lib/db/src artifacts/api-server/package.json artifacts/api-server/build.mjs lib/db/package.json pnpm-workspace.yaml package.json Dockerfile render.yaml .env.example 2>&1`,
      );
      if (!existsSync(zipPath)) {
        await ctx.reply("❌ Failed to create ZIP.");
        return;
      }
      await ctx.replyWithDocument(
        new InputFile(createReadStream(zipPath), "cric-inferno-bot.zip"),
        { caption: "📦 <b>CRIC INFERNO Bot Source</b>\n\nContains: bot source, DB schema, Dockerfile, render.yaml, .env.example\n\n<i>Deploy with: docker build + render.yaml or Render.com</i>", parse_mode: "HTML" },
      );
    } catch (err) {
      await ctx.reply(`❌ Export failed: ${String(err)}`);
    }
  });

  // /banuser <id>
  bot.command("banuser", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    const tid = ctx.message!.text.replace("/banuser", "").trim();
    if (!tid) { await ctx.reply("Usage: /banuser <telegram_id>"); return; }
    await banPlayer(tid);
    await ctx.reply(`🔨 User <code>${escHtml(tid)}</code> banned.`, { parse_mode: "HTML" });
  });

  // /unbanuser <id>
  bot.command("unbanuser", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    const tid = ctx.message!.text.replace("/unbanuser", "").trim();
    if (!tid) { await ctx.reply("Usage: /unbanuser <telegram_id>"); return; }
    await unbanPlayer(tid);
    await ctx.reply(`✅ User <code>${escHtml(tid)}</code> unbanned.`, { parse_mode: "HTML" });
  });

  // /resetstats <id>
  bot.command("resetstats", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    const tid = ctx.message!.text.replace("/resetstats", "").trim();
    if (!tid) { await ctx.reply("Usage: /resetstats <telegram_id>"); return; }
    await resetPlayerStats(tid);
    await ctx.reply(`♻️ Stats reset for <code>${escHtml(tid)}</code>.`, { parse_mode: "HTML" });
  });

  // /searchuser <name or id>
  bot.command("searchuser", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    const query = ctx.message!.text.replace("/searchuser", "").trim();
    if (!query) { await ctx.reply("Usage: /searchuser <name or telegram_id>"); return; }
    const players = await searchPlayer(query);
    if (!players.length) { await ctx.reply("No players found."); return; }
    let msg = `🔍 <b>Search Results:</b>\n\n`;
    for (const p of players) {
      msg += `👤 ${escHtml(p.firstName)}${p.username ? ` (@${escHtml(p.username)})` : ""}\n`;
      msg += `   ID: <code>${p.telegramId}</code> | M: ${p.matchesPlayed} | Runs: ${p.totalRuns} | W: ${p.wins}${p.banned ? " | 🔨 BANNED" : ""}\n\n`;
    }
    await ctx.reply(msg, { parse_mode: "HTML" });
  });

  // ── ADMIN PANEL CALLBACKS ────────────────────────────────────────────────

  bot.callbackQuery("admin:dashboard", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    await sendDashboard(ctx, true);
  });

  bot.callbackQuery("admin:media", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    if (ctx.chat?.type !== "private") {
      await ctx.reply("📩 Media manager works only in DM.");
      return;
    }
    await sendMediaManager(ctx);
  });

  bot.callbackQuery("admin:broadcast_menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    await sendBroadcastMenu(ctx);
  });

  bot.callbackQuery("admin:broadcast_text", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    pendingBroadcast[String(ctx.from!.id)] = "text";
    const groups = await getAllGroups();
    await ctx.reply(
      `📢 <b>Text Broadcast</b>\n\nWill send to <b>${groups.length}</b> groups.\nSend your message now.\n\n<i>Type /cancel to abort.</i>`,
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery("admin:broadcast_photo", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    pendingBroadcast[String(ctx.from!.id)] = "photo";
    await ctx.reply("📸 Send the photo now (with optional caption).\n\n<i>Type /cancel to abort.</i>", { parse_mode: "HTML" });
  });

  bot.callbackQuery("admin:matches", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    await sendMatchManagement(ctx);
  });

  bot.callbackQuery("admin:users", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    await sendUserManagement(ctx);
  });

  bot.callbackQuery("admin:settings", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    await sendGameSettings(ctx);
  });

  bot.callbackQuery("admin:setlink", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    await ctx.reply("Usage: /setlink <link>\nExample: /setlink https://t.me/InfernoPlayzone");
  });

  bot.callbackQuery("admin:back", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    await sendAdminPanel(ctx);
  });

  // Deploy to Render
  bot.callbackQuery("admin:deploy", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    const hookUrl = await getSetting("render_deploy_hook");
    if (!hookUrl) {
      await ctx.reply(
        "❌ No deploy hook set.\n\nUse /setdeploy <url> to set your Render deploy hook.\nGet it from: Render → Service → Settings → Deploy Hooks",
      );
      return;
    }

    await ctx.reply("🚀 Triggering Render deploy...");
    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.request(hookUrl, { method: "POST" }, (res) => {
          if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) resolve();
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
        req.on("error", reject);
        req.end();
      });
      await ctx.reply("✅ Deploy triggered successfully!\n\nCheck your Render dashboard for build progress.");
    } catch (err) {
      await ctx.reply(`❌ Deploy failed: ${String(err)}\n\nVerify your deploy hook URL with /setdeploy`);
    }
  });

  // Export code
  bot.callbackQuery("admin:exportcode", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    if (ctx.chat?.type !== "private") {
      await ctx.reply("📩 Use export in DM (admin panel).");
      return;
    }
    await ctx.reply("📦 Packaging source code...");
    try {
      const zipPath = "/tmp/cric-inferno-bot.zip";
      await execAsync(
        `cd /home/runner/workspace && zip -r ${zipPath} artifacts/api-server/src lib/db/src artifacts/api-server/package.json artifacts/api-server/build.mjs lib/db/package.json pnpm-workspace.yaml package.json Dockerfile render.yaml .env.example 2>&1`,
      );
      if (!existsSync(zipPath)) {
        await ctx.reply("❌ Failed to create ZIP.");
        return;
      }
      await ctx.replyWithDocument(
        new InputFile(createReadStream(zipPath), "cric-inferno-bot.zip"),
        { caption: "📦 <b>CRIC INFERNO Bot Source</b>\n\n<i>Includes Dockerfile + render.yaml for Render deployment.</i>", parse_mode: "HTML" },
      );
    } catch (err) {
      await ctx.reply(`❌ Export failed: ${String(err)}`);
    }
  });

  bot.callbackQuery("admin:maintenance", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    const current = await getSetting("maintenance");
    const newVal = current === "true" ? "false" : "true";
    await setSetting("maintenance", newVal);
    await ctx.reply(
      newVal === "true"
        ? "🔧 <b>Maintenance mode ON</b>"
        : "✅ <b>Maintenance mode OFF</b>",
      { parse_mode: "HTML" },
    );
  });

  // Force end a specific match
  bot.callbackQuery(/^admin:forceend:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    const matchId = parseInt(ctx.match[1]!);
    await updateMatch(matchId, { status: "finished", finishedAt: new Date() });
    await ctx.reply(`✅ Match #${matchId} force-ended.`);
    await sendMatchManagement(ctx);
  });

  // Toggle game settings
  bot.callbackQuery(/^admin:toggle:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    const key = ctx.match[1]!;
    const current = await getSetting(key);
    const newVal = current === "true" ? "false" : "true";
    await setSetting(key, newVal);
    await ctx.reply(`✅ Setting <b>${escHtml(key)}</b> → <b>${newVal}</b>`, { parse_mode: "HTML" });
    await sendGameSettings(ctx, true);
  });

  bot.callbackQuery("admin:searchuser", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isBotAdmin(ctx.from!.id)) return;
    pendingUserSearch[String(ctx.from!.id)] = "search";
    await ctx.reply("🔍 Send the username, name, or Telegram ID to search:\n\n<i>Type /cancel to abort.</i>", { parse_mode: "HTML" });
  });

  // ── Media slot selection ──────────────────────────────────────────────────
  for (const [key, label] of Object.entries(MEDIA_LABELS)) {
    bot.callbackQuery(`media:select:${key}`, async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!isBotAdmin(ctx.from!.id)) return;

      const count = await getMediaCount(key);
      pendingMediaUpload[String(ctx.from!.id)] = key;

      const kb = new InlineKeyboard()
        .text("🗑 Clear All Media", `media:clear:${key}`)
        .row()
        .text("« Back", "admin:media");

      await ctx.reply(
        `🖼 <b>${label}</b>\n\n` +
        `📁 Slot has <b>${count}</b> media file${count !== 1 ? "s" : ""}.\n\n` +
        `📸 <b>Send photos, videos, GIFs or animations</b> — each upload is added!\n` +
        `Bot randomly picks one each time.\n\n` +
        `<i>Type /cancel when done.</i>`,
        { parse_mode: "HTML", reply_markup: kb },
      );
    });

    bot.callbackQuery(`media:clear:${key}`, async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!isBotAdmin(ctx.from!.id)) return;
      await clearMedia(key);
      delete pendingMediaUpload[String(ctx.from!.id)];
      await ctx.reply(`🗑 <b>${label}</b> cleared!`, { parse_mode: "HTML" });
    });
  }

  // ── Media uploads ──────────────────────────────────────────────────────────
  bot.on("message:photo", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    if (ctx.chat.type !== "private") return;

    const bmode = pendingBroadcast[String(ctx.from!.id)];
    if (bmode === "photo") {
      delete pendingBroadcast[String(ctx.from!.id)];
      const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
      const caption = ctx.message.caption ?? "";
      const groups = await getAllGroups();
      let sent = 0;
      for (const g of groups) {
        try {
          await ctx.api.sendPhoto(g.chatId, photo.file_id, { caption, parse_mode: "HTML" });
          sent++;
        } catch { /* group unreachable */ }
      }
      await ctx.reply(`✅ Photo broadcast sent to <b>${sent}/${groups.length}</b> groups.`, { parse_mode: "HTML" });
      return;
    }

    const key = pendingMediaUpload[String(ctx.from!.id)];
    if (!key) return;
    const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
    const newCount = await appendMedia(key, photo.file_id);
    await ctx.reply(
      `✅ Photo added to <b>${MEDIA_LABELS[key] ?? key}</b>!\n📁 Total: <b>${newCount}</b>\n\n<i>Keep sending or /cancel to finish.</i>`,
      { parse_mode: "HTML" },
    );
  });

  bot.on("message:video", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    if (ctx.chat.type !== "private") return;
    const key = pendingMediaUpload[String(ctx.from!.id)];
    if (!key) return;
    const newCount = await appendMedia(key, ctx.message.video.file_id);
    await ctx.reply(
      `✅ Video added to <b>${MEDIA_LABELS[key] ?? key}</b>!\n📁 Total: <b>${newCount}</b>\n\n<i>Keep sending or /cancel to finish.</i>`,
      { parse_mode: "HTML" },
    );
  });

  bot.on("message:animation", async (ctx) => {
    if (!isBotAdmin(ctx.from!.id)) return;
    if (ctx.chat.type !== "private") return;
    const key = pendingMediaUpload[String(ctx.from!.id)];
    if (!key) return;
    const newCount = await appendMedia(key, ctx.message.animation.file_id);
    await ctx.reply(
      `✅ GIF/Animation added to <b>${MEDIA_LABELS[key] ?? key}</b>!\n📁 Total: <b>${newCount}</b>\n\n<i>Keep sending or /cancel to finish.</i>`,
      { parse_mode: "HTML" },
    );
  });

  // ── Text messages in DM (broadcast / user search / cancel) ────────────────
  bot.command("cancel", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const uid = String(ctx.from!.id);
    const mediaKey = pendingMediaUpload[uid];
    delete pendingMediaUpload[uid];
    delete pendingUserSearch[uid];
    delete pendingBroadcast[uid];

    if (mediaKey) {
      const count = await getMediaCount(mediaKey);
      await ctx.reply(
        `✅ Done! <b>${MEDIA_LABELS[mediaKey] ?? mediaKey}</b> has ${count} file${count !== 1 ? "s" : ""} saved.`,
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.reply("Cancelled.");
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isBotAdmin(ctx.from!.id)) return next();
    if (ctx.chat.type !== "private") return next();

    const uid = String(ctx.from!.id);
    const text = ctx.message.text;

    if (text.startsWith("/")) return next();

    if (pendingBroadcast[uid] === "text") {
      delete pendingBroadcast[uid];
      await doBroadcast(ctx, text);
      return;
    }

    if (pendingUserSearch[uid]) {
      delete pendingUserSearch[uid];
      const players = await searchPlayer(text);
      if (!players.length) { await ctx.reply("No players found."); return; }
      let msg = `🔍 <b>Search Results:</b>\n\n`;
      for (const p of players) {
        msg += `👤 ${escHtml(p.firstName)}${p.username ? ` (@${escHtml(p.username)})` : ""}\n`;
        msg += `   ID: <code>${p.telegramId}</code> | Matches: ${p.matchesPlayed} | Runs: ${p.totalRuns}${p.banned ? " | 🔨 BANNED" : ""}\n\n`;
      }
      await ctx.reply(msg, { parse_mode: "HTML" });
      return;
    }

    return next();
  });
}

// ── Admin panel main menu ───────────────────────────────────────────────────
async function sendAdminPanel(ctx: BotContext) {
  const s = await getBotStats();
  const uptime = formatUptime(Date.now() - botStartTime);
  const maintenance = await getSetting("maintenance");
  const deployHook = await getSetting("render_deploy_hook");
  const domains = process.env.REPLIT_DOMAINS ?? process.env.RENDER_EXTERNAL_URL ?? "unknown";
  const pingUrl = `https://${domains.split(",")[0]}/health`;

  const kb = new InlineKeyboard()
    .text("📊 Dashboard", "admin:dashboard").text("🎮 Matches", "admin:matches").row()
    .text("👥 Users", "admin:users").text("🖼 Media", "admin:media").row()
    .text("📢 Broadcast", "admin:broadcast_menu").text("⚙️ Settings", "admin:settings").row()
    .text("🔗 Set Playzone Link", "admin:setlink").text("🔧 Maintenance", "admin:maintenance").row()
    .text("🚀 Deploy to Render", "admin:deploy").text("📦 Export Code", "admin:exportcode");

  const maintenanceStatus = maintenance === "true" ? "🔧 ON" : "✅ OFF";

  await ctx.reply(
    `🛡️ <b>CRIC INFERNO — Admin Panel</b>\n\n` +
    `👤 Players: <b>${s.totalPlayers}</b>  |  🏏 Matches: <b>${s.totalMatches}</b>\n` +
    `⚡ Active: <b>${s.activeMatches}</b>  |  💬 Groups: <b>${s.totalGroups}</b>\n` +
    `⏱ Uptime: <b>${uptime}</b>  |  Maintenance: <b>${maintenanceStatus}</b>\n\n` +
    `🌐 <b>Uptime Ping URL:</b>\n<code>${pingUrl}</code>\n` +
    `<i>Use this URL with UptimeRobot / BetterStack for 24/7 monitoring.</i>\n\n` +
    `🚀 Deploy Hook: ${deployHook ? "✅ Set" : "❌ Not set — use /setdeploy"}`,
    { parse_mode: "HTML", reply_markup: kb },
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────────
async function sendDashboard(ctx: BotContext, edit = false) {
  const s = await getBotStats();
  const uptime = formatUptime(Date.now() - botStartTime);
  const memUsage = process.memoryUsage();
  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const usedMem = totalMem - freeMem;
  const memPct = ((usedMem / totalMem) * 100).toFixed(1);
  const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);

  const kb = new InlineKeyboard().text("« Back", "admin:back");

  const msg =
    `📊 <b>DASHBOARD</b>\n\n` +
    `👤 Total Players: <b>${s.totalPlayers}</b>\n` +
    `🔨 Banned: <b>${s.bannedPlayers}</b>\n` +
    `💬 Groups: <b>${s.totalGroups}</b>\n\n` +
    `🏏 Total Matches: <b>${s.totalMatches}</b>\n` +
    `⚔️ Solo Matches: <b>${s.soloMatches}</b>\n` +
    `👥 Team Matches: <b>${s.teamMatches}</b>\n` +
    `⚡ Active Matches: <b>${s.activeMatches}</b>\n\n` +
    `💻 <b>System</b>\n` +
    `RAM: <b>${(usedMem / 1024 / 1024).toFixed(0)}MB / ${(totalMem / 1024 / 1024).toFixed(0)}MB</b> (${memPct}%)\n` +
    `Heap: <b>${heapMB}MB</b>\n` +
    `CPUs: <b>${os.cpus().length}</b>  |  Platform: <b>${os.platform()}</b>\n` +
    `⏱ Bot Uptime: <b>${uptime}</b>`;

  if (edit) {
    try { await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb }); return; } catch { /* fall through */ }
  }
  await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
}

// ── Match Management ─────────────────────────────────────────────────────────
async function sendMatchManagement(ctx: BotContext) {
  const matches = await getAllActiveMatches();

  const kb = new InlineKeyboard();
  if (matches.length === 0) {
    kb.text("No active matches", "admin:matches");
  } else {
    for (const m of matches.slice(0, 8)) {
      kb.text(`❌ Force End #${m.id}`, `admin:forceend:${m.id}`).row();
    }
  }
  kb.row().text("« Back", "admin:back");

  let msg = `🎮 <b>MATCH MANAGEMENT</b>\n\n`;
  if (matches.length === 0) {
    msg += `No active matches right now.\n`;
  } else {
    msg += `<b>${matches.length} active match(es):</b>\n\n`;
    for (const m of matches) {
      msg += `• #${m.id} [${m.mode}] ${m.status}\n  Chat: <code>${m.chatId}</code>\n`;
    }
  }

  await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
}

// ── User Management ───────────────────────────────────────────────────────────
async function sendUserManagement(ctx: BotContext) {
  const kb = new InlineKeyboard()
    .text("🔍 Search User", "admin:searchuser").row()
    .text("« Back", "admin:back");

  await ctx.reply(
    `👥 <b>USER MANAGEMENT</b>\n\n` +
    `• <code>/banuser &lt;id&gt;</code> — Ban a user\n` +
    `• <code>/unbanuser &lt;id&gt;</code> — Unban a user\n` +
    `• <code>/resetstats &lt;id&gt;</code> — Reset player stats\n` +
    `• <code>/searchuser &lt;name/id&gt;</code> — Search player\n`,
    { parse_mode: "HTML", reply_markup: kb },
  );
}

// ── Broadcast menu ────────────────────────────────────────────────────────────
async function sendBroadcastMenu(ctx: BotContext) {
  const groups = await getAllGroups();

  const kb = new InlineKeyboard()
    .text("📝 Text Broadcast", "admin:broadcast_text").row()
    .text("📸 Photo Broadcast", "admin:broadcast_photo").row()
    .text("« Back", "admin:back");

  await ctx.reply(
    `📢 <b>BROADCAST</b>\n\n` +
    `Will send to <b>${groups.length}</b> group(s).\n\n` +
    `Choose broadcast type:`,
    { parse_mode: "HTML", reply_markup: kb },
  );
}

// ── Game Settings ─────────────────────────────────────────────────────────────
async function sendGameSettings(ctx: BotContext, edit = false) {
  const [soloEnabled, teamEnabled, afkTimer, defaultSpell] = await Promise.all([
    getSetting("solo_enabled"),
    getSetting("team_enabled"),
    getSetting("afk_timer"),
    getSetting("default_spell"),
  ]);

  const soloOn = soloEnabled !== "false";
  const teamOn = teamEnabled !== "false";

  const kb = new InlineKeyboard()
    .text(`Solo Mode: ${soloOn ? "✅" : "❌"}`, "admin:toggle:solo_enabled").row()
    .text(`Team Mode: ${teamOn ? "✅" : "❌"}`, "admin:toggle:team_enabled").row()
    .text("« Back", "admin:back");

  const msg =
    `⚙️ <b>GAME SETTINGS</b>\n\n` +
    `⚔️ Solo Mode: <b>${soloOn ? "Enabled" : "Disabled"}</b>\n` +
    `👥 Team Mode: <b>${teamOn ? "Enabled" : "Disabled"}</b>\n` +
    `⏱ AFK Timer: <b>${afkTimer ?? "120"}s</b>\n` +
    `🎯 Default Spell: <b>${defaultSpell ?? "3"} balls</b>`;

  if (edit) {
    try { await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb }); return; } catch { /* fall through */ }
  }
  await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
}

// ── Media manager ─────────────────────────────────────────────────────────────
async function sendMediaManager(ctx: BotContext) {
  const keys = Object.keys(MEDIA_LABELS);
  const counts = await Promise.all(keys.map((k) => getMediaCount(k)));

  const kb = new InlineKeyboard();
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const count = counts[i]!;
    const label = MEDIA_LABELS[k]!;
    const badge = count > 0 ? ` (${count})` : " (0)";
    kb.text(`${label}${badge}`, `media:select:${k}`).row();
  }
  kb.text("« Back", "admin:back");

  await ctx.reply(
    `🖼 <b>MEDIA MANAGER</b>\n\n` +
    `Tap a slot to add/replace media.\n` +
    `Each slot can hold multiple files — bot picks one randomly.\n\n` +
    `<b>${keys.length} slots available:</b>`,
    { parse_mode: "HTML", reply_markup: kb },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function doBroadcast(ctx: BotContext, text: string) {
  const groups = await getAllGroups();
  let sent = 0;
  for (const g of groups) {
    try {
      await ctx.api.sendMessage(g.chatId, text, { parse_mode: "HTML" });
      sent++;
    } catch { /* group unreachable */ }
  }
  await ctx.reply(`✅ Broadcast sent to <b>${sent}/${groups.length}</b> groups.`, { parse_mode: "HTML" });
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
