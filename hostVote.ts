import type { BotContext } from "../context.js";
import { InlineKeyboard } from "grammy";
import { updateMatch, getPlayer } from "../utils/db.js";
import { mention, escHtml } from "../utils/format.js";
import type { Match } from "@workspace/db";

type P = { id: string; name: string };

interface VoteState {
  matchId: number;
  chatId: string;
  teamAPlayers: P[];
  teamBPlayers: P[];
  hostId: string;
  teamAVotes: Set<string>;
  teamBVotes: Set<string>;
  messageId: number | null;
  timer: ReturnType<typeof setTimeout>;
}

const activeVotes = new Map<string, VoteState>(); // key: chatId

export async function startHostVote(ctx: BotContext, match: Match) {
  const chatId = String(ctx.chat!.id);

  if (activeVotes.has(chatId)) {
    await ctx.reply("⚠️ A host change vote is already in progress!");
    return;
  }

  const allPlayers = [
    ...(match.teamAPlayers as P[]),
    ...(match.teamBPlayers as P[]),
  ];
  const userId = String(ctx.from!.id);

  // Requester must be a match player
  if (!allPlayers.find((p) => p.id === userId)) {
    await ctx.reply("Only match players can initiate a host vote.");
    return;
  }

  const kb = new InlineKeyboard()
    .text("✅ Vote (Team A)", `hvote:a:${match.id}`)
    .text("✅ Vote (Team B)", `hvote:b:${match.id}`)
    .row()
    .text("❌ Cancel (Host Only)", `hvote:cancel:${match.id}`);

  const sent = await ctx.reply(
    `🗳️ <b>Host Change Vote</b>\n\n` +
    `Need <b>2 votes from Team A</b> + <b>2 votes from Team B</b> (4 total)\n\n` +
    `🔵 Team A: 0/2 votes\n🔴 Team B: 0/2 votes\n\n` +
    `⏳ Vote expires in <b>2 minutes</b>\n` +
    `Only the current host can cancel.`,
    { parse_mode: "HTML", reply_markup: kb },
  );

  const timer = setTimeout(async () => {
    if (!activeVotes.has(chatId)) return;
    activeVotes.delete(chatId);
    try {
      await ctx.api.editMessageText(
        chatId,
        sent.message_id,
        `🗳️ <b>Host Vote Expired</b>\n\nDid not reach 2+2 votes in time. Vote cancelled.`,
        { parse_mode: "HTML" },
      );
    } catch { /* ignore */ }
  }, 2 * 60 * 1000);

  activeVotes.set(chatId, {
    matchId: match.id,
    chatId,
    teamAPlayers: (match.teamAPlayers as P[]) ?? [],
    teamBPlayers: (match.teamBPlayers as P[]) ?? [],
    hostId: match.hostId ?? "",
    teamAVotes: new Set(),
    teamBVotes: new Set(),
    messageId: sent.message_id,
    timer,
  });
}

export function registerHostVoteCallbacks(bot: import("grammy").Bot<BotContext>) {
  // Team A vote
  bot.callbackQuery(/^hvote:a:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const matchId = parseInt(ctx.match[1]!);
    const chatId = String(ctx.chat!.id);
    const userId = String(ctx.from!.id);
    const state = activeVotes.get(chatId);
    if (!state || state.matchId !== matchId) return;

    if (!state.teamAPlayers.find((p) => p.id === userId)) {
      await ctx.answerCallbackQuery("Only Team A players can vote here!");
      return;
    }
    if (state.teamAVotes.has(userId)) {
      await ctx.answerCallbackQuery("You already voted!");
      return;
    }
    state.teamAVotes.add(userId);
    await updateVoteMessage(ctx, state, matchId, chatId);
  });

  // Team B vote
  bot.callbackQuery(/^hvote:b:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const matchId = parseInt(ctx.match[1]!);
    const chatId = String(ctx.chat!.id);
    const userId = String(ctx.from!.id);
    const state = activeVotes.get(chatId);
    if (!state || state.matchId !== matchId) return;

    if (!state.teamBPlayers.find((p) => p.id === userId)) {
      await ctx.answerCallbackQuery("Only Team B players can vote here!");
      return;
    }
    if (state.teamBVotes.has(userId)) {
      await ctx.answerCallbackQuery("You already voted!");
      return;
    }
    state.teamBVotes.add(userId);
    await updateVoteMessage(ctx, state, matchId, chatId);
  });

  // Cancel (host only)
  bot.callbackQuery(/^hvote:cancel:(\d+)$/, async (ctx) => {
    const matchId = parseInt(ctx.match[1]!);
    const chatId = String(ctx.chat!.id);
    const userId = String(ctx.from!.id);
    const state = activeVotes.get(chatId);

    if (!state || state.matchId !== matchId) {
      await ctx.answerCallbackQuery("No active vote.");
      return;
    }
    if (state.hostId !== userId) {
      await ctx.answerCallbackQuery("Only the current host can cancel the vote!");
      return;
    }

    clearTimeout(state.timer);
    activeVotes.delete(chatId);
    await ctx.answerCallbackQuery("Vote cancelled.");

    try {
      await ctx.editMessageText(
        `🗳️ <b>Host Vote Cancelled</b>\n\nThe current host cancelled the vote.`,
        { parse_mode: "HTML" },
      );
    } catch { /* ignore */ }
  });

  // Select new host
  bot.callbackQuery(/^hvote:select:(\d+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const matchId = parseInt(ctx.match[1]!);
    const newHostId = ctx.match[2]!;
    const chatId = String(ctx.chat!.id);
    const userId = String(ctx.from!.id);
    const state = activeVotes.get(chatId);

    // Only match players can click
    if (!state) return;
    const allPlayers = [...state.teamAPlayers, ...state.teamBPlayers];
    if (!allPlayers.find((p) => p.id === userId)) {
      await ctx.answerCallbackQuery("Only match players can select the new host!");
      return;
    }

    const newHost = allPlayers.find((p) => p.id === newHostId);
    if (!newHost) return;

    clearTimeout(state.timer);
    activeVotes.delete(chatId);

    await updateMatch(matchId, { hostId: newHostId });

    try {
      await ctx.editMessageText(
        `✅ <b>New Host Selected!</b>\n\n${mention(newHost.name, newHostId)} is now the host!`,
        { parse_mode: "HTML" },
      );
    } catch { /* ignore */ }
  });
}

async function updateVoteMessage(ctx: BotContext, state: VoteState, matchId: number, chatId: string) {
  const aVotes = state.teamAVotes.size;
  const bVotes = state.teamBVotes.size;

  if (aVotes >= 2 && bVotes >= 2) {
    // Vote passed — show selection buttons
    clearTimeout(state.timer);
    activeVotes.delete(chatId);

    const allPlayers = [...state.teamAPlayers, ...state.teamBPlayers];
    const kb = new InlineKeyboard();
    for (const p of allPlayers) {
      kb.text(escHtml(p.name), `hvote:select:${matchId}:${p.id}`).row();
    }

    try {
      await ctx.editMessageText(
        `✅ <b>Vote Passed! (${aVotes + bVotes}/4)</b>\n\n` +
        `Select the new host from match players:`,
        { parse_mode: "HTML", reply_markup: kb },
      );
    } catch { /* ignore */ }
  } else {
    const kb = new InlineKeyboard()
      .text(`✅ Vote (Team A) ${aVotes}/2`, `hvote:a:${matchId}`)
      .text(`✅ Vote (Team B) ${bVotes}/2`, `hvote:b:${matchId}`)
      .row()
      .text("❌ Cancel (Host Only)", `hvote:cancel:${matchId}`);

    try {
      await ctx.editMessageText(
        `🗳️ <b>Host Change Vote</b>\n\n` +
        `🔵 Team A: ${aVotes}/2 votes\n` +
        `🔴 Team B: ${bVotes}/2 votes\n\n` +
        `⏳ Vote expires in 2 minutes\n` +
        `Only the current host can cancel.`,
        { parse_mode: "HTML", reply_markup: kb },
      );
    } catch { /* ignore */ }
  }
}
