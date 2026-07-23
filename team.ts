import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../context.js";
import {
  getActiveMatch,
  createMatch,
  updateMatch,
  upsertPlayer,
  getPlayer,
  getPlayerByUsername,
} from "../utils/db.js";
import { sendWithMedia, MEDIA_KEYS } from "../utils/media.js";
import {
  teamLobbyText,
  membersText,
  mention,
  escHtml,
} from "../utils/format.js";
import { isAdmin } from "../utils/admin.js";
import { startToss } from "./toss.js";

type P = { id: string; name: string };

async function maybeAutoStartToss(ctx: BotContext, chatId: string) {
  const match = await getActiveMatch(chatId);
  if (!match || match.mode !== "team" || match.status !== "lobby") return;
  if (!match.teamACaptainId || !match.teamBCaptainId || !match.overs) return;
  await startToss(ctx, match);
}

export function registerTeamHandlers(bot: Bot<BotContext>) {
  // I Will Be Host
  bot.callbackQuery("team:host", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type === "private") return;
    const chatId = String(ctx.chat!.id);
    const user = ctx.from!;
    await upsertPlayer(String(user.id), user.first_name, user.username);

    const existing = await getActiveMatch(chatId);
    if (existing) {
      await ctx.reply("A match is already active! Finish it first.");
      return;
    }

    const match = await createMatch({
      chatId,
      mode: "team",
      status: "lobby",
      hostId: String(user.id),
      teamAPlayers: [],
      teamBPlayers: [],
    });

    const kb = new InlineKeyboard()
      .text("🔵 Join Team A", "team:joinA")
      .text("🔴 Join Team B", "team:joinB");

    await sendWithMedia(ctx, MEDIA_KEYS.TEAM_BANNER, "🏟️ Team match lobby opening...", { parse_mode: "HTML" });
    const lobbyMsg = await ctx.reply(
      teamLobbyText([], [], user.first_name) +
        `\n\n👑 <b>Host:</b> ${mention(user.first_name, String(user.id))}\n\n` +
        `<b>Host commands:</b>\n/create_teams — Start team creation\n/add A @user — Add player to Team A\n/add B @user — Add player to Team B\n/choose_cap — Select captains\n/set_overs — Set overs\n/remove — Remove player`,
      { reply_markup: kb, parse_mode: "HTML" },
    );
    await updateMatch(match.id, { lobbyMessageId: lobbyMsg.message_id });
  });

  // /create_teams
  bot.command("create_teams", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") {
      await ctx.reply("No active team match. Use /start and select Team Mode.");
      return;
    }
    const user = ctx.from!;
    if (match.hostId !== String(user.id)) {
      await ctx.reply("Only the host can create teams.");
      return;
    }

    const teamA = (match.teamAPlayers as P[]) ?? [];
    const teamB = (match.teamBPlayers as P[]) ?? [];

    const hostName = user.first_name;
    const kb = new InlineKeyboard()
      .text("🔵 Join Team A", "team:joinA")
      .text("🔴 Join Team B", "team:joinB");

    await sendWithMedia(ctx, MEDIA_KEYS.JOIN_TEAM_BANNER, "🏟️ Team lobby:", { parse_mode: "HTML" });
    const sent = await ctx.reply(teamLobbyText(teamA, teamB, hostName), { reply_markup: kb, parse_mode: "HTML" });
    await updateMatch(match.id, { lobbyMessageId: sent.message_id });
  });

  // Join Team A / B
  bot.callbackQuery("team:joinA", handleJoinTeam("A"));
  bot.callbackQuery("team:joinB", handleJoinTeam("B"));

  // /add A/B (reply, @username, ID, multiple)
  bot.command("add", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") {
      await ctx.reply("No active team match.");
      return;
    }

    const userId = String(ctx.from!.id);
    const isHost = match.hostId === userId;
    const isGroupAdmin = await isAdmin(ctx);
    if (!isHost && !isGroupAdmin) {
      await ctx.reply("Only the host or group admins can add players.");
      return;
    }

    const fullText = ctx.message!.text;
    const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean);
    // First line: /add A or /add B
    const firstLine = lines[0]!;
    const parts = firstLine.split(/\s+/);
    const teamLetter = parts[1]?.toUpperCase() as "A" | "B" | undefined;
    if (teamLetter !== "A" && teamLetter !== "B") {
      await ctx.reply(
        "Usage:\n" +
        "/add A — reply to player to add to Team A\n" +
        "/add B — reply to player to add to Team B\n" +
        "/add A @user1 @user2 — add by username\n" +
        "/add A 123456 789012 — add by Telegram ID\n\n" +
        "Or multiline:\n/add A\n@user1\n12345678",
      );
      return;
    }

    // Collect targets: from reply + from remaining args
    const targets: { id: string; name: string }[] = [];

    // From reply
    const reply = ctx.message?.reply_to_message;
    if (reply?.from && !reply.from.is_bot) {
      await upsertPlayer(String(reply.from.id), reply.from.first_name, reply.from.username);
      targets.push({ id: String(reply.from.id), name: reply.from.first_name });
    }

    // From args on first line (after /add A)
    const firstLineArgs = parts.slice(2);
    // From subsequent lines
    const restLines = lines.slice(1);
    const allArgs = [...firstLineArgs, ...restLines];

    for (const arg of allArgs) {
      for (const token of arg.split(/\s+/)) {
        const t = token.trim();
        if (!t) continue;
        if (/^\d{5,}$/.test(t)) {
          // Telegram ID
          const p = await getPlayer(t);
          if (p) targets.push({ id: p.telegramId, name: p.firstName });
          else targets.push({ id: t, name: `User#${t}` });
        } else {
          const uname = t.replace(/^@/, "");
          const p = await getPlayerByUsername(uname);
          if (p) targets.push({ id: p.telegramId, name: p.firstName });
          else {
            // fallback: use username as display name
            targets.push({ id: `@${uname}`, name: uname });
          }
        }
      }
    }

    if (targets.length === 0) {
      await ctx.reply("No players found to add. Reply to a player or provide @usernames/IDs.");
      return;
    }

    const teamA = (match.teamAPlayers as P[]) ?? [];
    const teamB = (match.teamBPlayers as P[]) ?? [];
    const allPlayers = [...teamA, ...teamB];

    let added = 0;
    const addedNames: string[] = [];
    const skippedNames: string[] = [];

    for (const t of targets) {
      // Already in a team?
      if (allPlayers.find((p) => p.id === t.id)) {
        skippedNames.push(t.name);
        continue;
      }
      if (teamLetter === "A") teamA.push(t);
      else teamB.push(t);
      added++;
      addedNames.push(t.name);
    }

    if (added > 0) {
      await updateMatch(match.id, { teamAPlayers: teamA, teamBPlayers: teamB });
      // Update lobby message
      if (match.lobbyMessageId) {
        try {
          const hostPlayer = await getPlayer(match.hostId ?? "");
          await ctx.api.editMessageText(
            ctx.chat.id,
            match.lobbyMessageId,
            teamLobbyText(teamA, teamB, hostPlayer?.firstName ?? "Host"),
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard()
                .text("🔵 Join Team A", "team:joinA")
                .text("🔴 Join Team B", "team:joinB"),
            },
          );
        } catch { /* ignore */ }
      }
    }

    let msg = "";
    if (addedNames.length) msg += `✅ Added to Team ${teamLetter}: ${addedNames.map(escHtml).join(", ")}\n`;
    if (skippedNames.length) msg += `⚠️ Already in teams: ${skippedNames.map(escHtml).join(", ")}`;
    if (teamA.length >= 2 && teamB.length >= 2) {
      msg += `\n\n✅ Teams ready! (${teamA.length} vs ${teamB.length}) Use /choose_cap next.`;
    }
    await ctx.reply(msg, { parse_mode: "HTML" });
  });

  // /members
  bot.command("members", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") {
      await ctx.reply("No active team match.");
      return;
    }
    // Fill in host name from first name if possible
    let hostName = match.hostId ?? "";
    if (match.hostId) {
      const hp = await getPlayer(match.hostId);
      if (hp) hostName = hp.firstName;
    }
    // Inject host name for display
    const matchWithHost = { ...match, hostId: hostName };
    await ctx.reply(membersText(matchWithHost as typeof match), { parse_mode: "HTML" });
  });

  // /score
  bot.command("score", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") {
      await ctx.reply("No active team match to show score for.");
      return;
    }
    const { formatScore } = await import("../utils/format.js");
    await ctx.reply(formatScore(match), { parse_mode: "HTML" });
  });

  // /choose_cap (also accepts /choose_caps for backward compat)
  bot.command(["choose_cap", "choose_caps"], async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") {
      await ctx.reply("No active team match.");
      return;
    }
    if (match.hostId !== String(ctx.from!.id)) {
      await ctx.reply("Only the host can initiate captain selection.");
      return;
    }

    const kb = new InlineKeyboard()
      .text("👑 Become Team A Captain", "cap:A")
      .row()
      .text("👑 Become Team B Captain", "cap:B");

    await sendWithMedia(
      ctx,
      MEDIA_KEYS.CAPTAIN_BANNER,
      `👑 <b>Choose Team Captains</b>\n\n` +
        `Team A Captain: ${match.teamACaptainId ? "✅ Selected" : "Not Selected"}\n` +
        `Team B Captain: ${match.teamBCaptainId ? "✅ Selected" : "Not Selected"}`,
      { reply_markup: kb, parse_mode: "HTML" },
    );
  });

  // Captain callbacks
  bot.callbackQuery("cap:A", handleCapSelect("A"));
  bot.callbackQuery("cap:B", handleCapSelect("B"));

  // /set_overs
  bot.command("set_overs", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") return;
    if (match.hostId !== String(ctx.from!.id)) {
      await ctx.reply("Only the host can set overs.");
      return;
    }
    const kb = new InlineKeyboard()
      .text("2", "overs:2").text("5", "overs:5").text("8", "overs:8").text("12", "overs:12").text("15", "overs:15")
      .row()
      .text("20", "overs:20").text("30", "overs:30").text("50", "overs:50").text("100", "overs:100").text("999", "overs:999");
    await ctx.reply("🏏 Select Overs:", { reply_markup: kb });
  });

  // Overs callbacks
  for (const n of [2, 5, 8, 12, 15, 20, 30, 50, 100, 999]) {
    bot.callbackQuery(`overs:${n}`, async (ctx) => {
      await ctx.answerCallbackQuery(`Set to ${n} overs`);
      const match = await getActiveMatch(String(ctx.chat!.id));
      if (!match) return;
      await updateMatch(match.id, { overs: n });
      await ctx.reply(`✅ Match set to <b>${n} overs</b>.`, { parse_mode: "HTML" });
      await maybeAutoStartToss(ctx, String(ctx.chat!.id));
    });
  }

  // /changeover
  bot.command("changeover", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") return;
    if (match.hostId !== String(ctx.from!.id)) {
      await ctx.reply("Only the host can change overs.");
      return;
    }
    const parts = ctx.message!.text.split(" ");
    const n = parseInt(parts[1] ?? "");
    if (isNaN(n) || n < 1 || n > 1000) {
      await ctx.reply("Usage: /changeover <1-1000>");
      return;
    }
    await updateMatch(match.id, { overs: n });
    await ctx.reply(`✅ Match changed to <b>${n} overs</b>.`, { parse_mode: "HTML" });
  });

  // /changehost — host can directly transfer, others vote
  bot.command("changehost", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") return;
    const userId = String(ctx.from!.id);

    if (match.hostId === userId) {
      // Direct transfer
      const reply = ctx.message?.reply_to_message;
      let targetId: string | null = null;
      let targetName = "";
      if (reply?.from && !reply.from.is_bot) {
        targetId = String(reply.from.id);
        targetName = reply.from.first_name;
      } else {
        const parts = ctx.message!.text.split(" ");
        const uname = parts[1]?.replace("@", "");
        if (uname) {
          const allPlayers = [
            ...(match.teamAPlayers as P[]),
            ...(match.teamBPlayers as P[]),
          ];
          const found = allPlayers.find(
            (p) => p.name.toLowerCase() === uname.toLowerCase(),
          );
          if (found) {
            targetId = found.id;
            targetName = found.name;
          }
        }
      }
      if (!targetId) {
        await ctx.reply(
          "Reply to a player or use /changehost @username to transfer host directly.\n\n" +
          "Or for voting: non-hosts can use /changehost to start a vote.",
        );
        return;
      }
      const oldHost = ctx.from!.first_name;
      await updateMatch(match.id, { hostId: targetId });
      await ctx.reply(
        `👑 <b>Host Transferred!</b>\n\nOld: ${mention(oldHost, userId)}\nNew: ${mention(targetName, targetId)}`,
        { parse_mode: "HTML" },
      );
    } else {
      // Vote system — handled in index.ts
      const { startHostVote } = await import("./hostVote.js");
      await startHostVote(ctx, match);
    }
  });

  // /remove (reply, username, or ID)
  bot.command("remove", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") return;
    const userId = String(ctx.from!.id);
    const isHost = match.hostId === userId;
    const isGroupAdmin = await isAdmin(ctx);
    if (!isHost && !isGroupAdmin) {
      await ctx.reply("Only the host or group admins can remove players.");
      return;
    }

    let targetId: string | null = null;
    let targetName = "";
    const reply = ctx.message?.reply_to_message;

    if (reply?.from) {
      targetId = String(reply.from.id);
      targetName = reply.from.first_name;
    } else {
      const parts = ctx.message!.text.split(" ").slice(1);
      const token = parts[0]?.replace("@", "");
      if (token) {
        if (/^\d{5,}$/.test(token)) {
          // by ID
          const all = [
            ...(match.teamAPlayers as P[]),
            ...(match.teamBPlayers as P[]),
          ];
          const found = all.find((p) => p.id === token);
          if (found) { targetId = found.id; targetName = found.name; }
        } else {
          // by username or name
          const all = [
            ...(match.teamAPlayers as P[]),
            ...(match.teamBPlayers as P[]),
          ];
          const found = all.find(
            (p) => p.name.toLowerCase() === token.toLowerCase(),
          );
          if (found) { targetId = found.id; targetName = found.name; }
          else {
            const p = await getPlayerByUsername(token);
            if (p) {
              targetId = p.telegramId;
              targetName = p.firstName;
            }
          }
        }
      }
    }

    if (!targetId) {
      await ctx.reply("Reply to a player, or use /remove @username or /remove <id>");
      return;
    }

    const teamA = (match.teamAPlayers as P[]).filter((p) => p.id !== targetId);
    const teamB = (match.teamBPlayers as P[]).filter((p) => p.id !== targetId);

    // Check if player was in a team
    const removedFromA = (match.teamAPlayers as P[]).find((p) => p.id === targetId);
    const removedFromB = (match.teamBPlayers as P[]).find((p) => p.id === targetId);
    if (!removedFromA && !removedFromB) {
      await ctx.reply("Player not found in any team.");
      return;
    }

    await updateMatch(match.id, { teamAPlayers: teamA, teamBPlayers: teamB });
    await ctx.reply(
      `✅ ${mention(targetName, targetId)} removed from ${removedFromA ? "Team A" : "Team B"}.`,
      { parse_mode: "HTML" },
    );

    // Update lobby message
    if (match.lobbyMessageId) {
      try {
        const hostPlayer = await getPlayer(match.hostId ?? "");
        await ctx.api.editMessageText(
          ctx.chat.id,
          match.lobbyMessageId,
          teamLobbyText(teamA, teamB, hostPlayer?.firstName ?? "Host"),
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("🔵 Join Team A", "team:joinA")
              .text("🔴 Join Team B", "team:joinB"),
          },
        );
      } catch { /* ignore */ }
    }
  });

  // /changecap A/B (reply, username, or ID)
  bot.command("changecap", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const match = await getActiveMatch(String(ctx.chat.id));
    if (!match || match.mode !== "team") return;
    const userId = String(ctx.from!.id);
    const isHost = match.hostId === userId;
    const isGroupAdmin = await isAdmin(ctx);
    if (!isHost && !isGroupAdmin) {
      await ctx.reply("Only the host or group admins can change captains.");
      return;
    }

    const parts = ctx.message!.text.split(" ");
    const team = parts[1]?.toUpperCase() as "A" | "B";
    if (team !== "A" && team !== "B") {
      await ctx.reply("Usage: /changecap A or /changecap B\nReply to player or add @username/ID");
      return;
    }

    let targetId: string | null = null;
    let targetName = "";
    const reply = ctx.message?.reply_to_message;

    if (reply?.from && !reply.from.is_bot) {
      targetId = String(reply.from.id);
      targetName = reply.from.first_name;
    } else {
      const token = parts[2]?.replace("@", "");
      if (token) {
        if (/^\d{5,}$/.test(token)) {
          const players = (team === "A" ? match.teamAPlayers : match.teamBPlayers) as P[];
          const found = players.find((p) => p.id === token);
          if (found) { targetId = found.id; targetName = found.name; }
        } else {
          const players = (team === "A" ? match.teamAPlayers : match.teamBPlayers) as P[];
          const found = players.find((p) => p.name.toLowerCase() === token.toLowerCase());
          if (found) { targetId = found.id; targetName = found.name; }
          else {
            const p = await getPlayerByUsername(token);
            if (p) { targetId = p.telegramId; targetName = p.firstName; }
          }
        }
      }
    }

    if (!targetId) {
      await ctx.reply("Reply to a player or use /changecap A @username");
      return;
    }

    // Verify player is in that team
    const teamPlayers = (team === "A" ? match.teamAPlayers : match.teamBPlayers) as P[];
    if (!teamPlayers.find((p) => p.id === targetId)) {
      await ctx.reply(`${mention(targetName, targetId)} is not in Team ${team}.`, { parse_mode: "HTML" });
      return;
    }

    const update = team === "A" ? { teamACaptainId: targetId } : { teamBCaptainId: targetId };
    await updateMatch(match.id, update);
    await ctx.reply(
      `👑 Team ${team} Captain changed to ${mention(targetName, targetId)}`,
      { parse_mode: "HTML" },
    );
  });
}

function handleJoinTeam(team: "A" | "B") {
  return async (ctx: BotContext) => {
    if (ctx.chat?.type === "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    const match = await getActiveMatch(String(ctx.chat!.id));
    if (!match || match.mode !== "team") {
      await ctx.answerCallbackQuery();
      return;
    }

    const user = ctx.from!;
    await upsertPlayer(String(user.id), user.first_name, user.username);

    const teamA = (match.teamAPlayers as P[]) ?? [];
    const teamB = (match.teamBPlayers as P[]) ?? [];

    if (
      teamA.find((p) => p.id === String(user.id)) ||
      teamB.find((p) => p.id === String(user.id))
    ) {
      await ctx.answerCallbackQuery("You're already in a team!");
      return;
    }

    await ctx.answerCallbackQuery();

    const newPlayer: P = { id: String(user.id), name: user.first_name };
    if (team === "A") teamA.push(newPlayer);
    else teamB.push(newPlayer);

    await updateMatch(match.id, { teamAPlayers: teamA, teamBPlayers: teamB });

    // Get host name for lobby
    const hostPlayer = await getPlayer(match.hostId ?? "");
    const hostName = hostPlayer?.firstName ?? "Host";

    try {
      await ctx.editMessageText(teamLobbyText(teamA, teamB, hostName), {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🔵 Join Team A", "team:joinA")
          .text("🔴 Join Team B", "team:joinB"),
      });
    } catch { /* ignore */ }

    if (teamA.length >= 2 && teamB.length >= 2) {
      await ctx.reply(
        `✅ <b>Teams ready!</b>\n\n🔵 Team A: ${teamA.length} players\n🔴 Team B: ${teamB.length} players\n\n👑 Host: use /choose_cap to select captains.`,
        { parse_mode: "HTML" },
      );
    }
  };
}

function handleCapSelect(team: "A" | "B") {
  return async (ctx: BotContext) => {
    const match = await getActiveMatch(String(ctx.chat!.id));
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }

    const user = ctx.from!;
    if (match.hostId === String(user.id)) {
      await ctx.answerCallbackQuery("Host cannot become captain!");
      return;
    }

    const teamPlayers = (
      team === "A" ? match.teamAPlayers : match.teamBPlayers
    ) as P[];

    if (!teamPlayers.find((p) => p.id === String(user.id))) {
      await ctx.answerCallbackQuery(`You're not in Team ${team}!`);
      return;
    }

    if (team === "A" && match.teamACaptainId) {
      await ctx.answerCallbackQuery("Team A already has a captain!");
      return;
    }
    if (team === "B" && match.teamBCaptainId) {
      await ctx.answerCallbackQuery("Team B already has a captain!");
      return;
    }

    await ctx.answerCallbackQuery();

    const update =
      team === "A"
        ? { teamACaptainId: String(user.id) }
        : { teamBCaptainId: String(user.id) };
    await updateMatch(match.id, update);

    const updatedACap = team === "A" ? String(user.id) : match.teamACaptainId;
    const updatedBCap = team === "B" ? String(user.id) : match.teamBCaptainId;

    try {
      await ctx.editMessageText(
        `👑 <b>Captain Selection</b>\n\nTeam A Captain: ${updatedACap ? "✅ Selected" : "Not Selected"}\nTeam B Captain: ${updatedBCap ? "✅ Selected" : "Not Selected"}`,
        {
          parse_mode: "HTML",
          reply_markup:
            updatedACap && updatedBCap
              ? new InlineKeyboard()
              : new InlineKeyboard()
                  .text("👑 Become Team A Captain", "cap:A")
                  .row()
                  .text("👑 Become Team B Captain", "cap:B"),
        },
      );
    } catch { /* ignore */ }

    if (updatedACap && updatedBCap) {
      await ctx.reply(
        `✅ <b>Both captains selected!</b>\n\nHost: use /set_overs to set match overs.`,
        { parse_mode: "HTML" },
      );
      await maybeAutoStartToss(ctx, String(ctx.chat!.id));
    }
  };
}
