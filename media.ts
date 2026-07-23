import type { Api, Context } from "grammy";
import { getRandomMediaFileId } from "./db.js";
import { logger } from "../../lib/logger.js";

export const MEDIA_KEYS = {
  START_BANNER: "start_banner",
  DM_START_BANNER: "dm_start_banner",
  SOLO_BANNER: "solo_banner",
  TEAM_BANNER: "team_banner",
  JOIN_TEAM_BANNER: "join_team_banner",
  CAPTAIN_BANNER: "captain_banner",
  TOSS_BANNER: "toss_banner",
  BATTING_BANNER: "batting_banner",
  BOWLING_BANNER: "bowling_banner",
  MATCH_START_BANNER: "match_start_banner",
  VICTORY_BANNER: "victory_banner",
  INNINGS_BREAK_BANNER: "innings_break_banner",
  RUN_0: "run_0",
  RUN_1: "run_1",
  RUN_2: "run_2",
  RUN_3: "run_3",
  RUN_4: "run_4",
  RUN_5: "run_5",
  RUN_6: "run_6",
  WICKET: "wicket",
  MILESTONE_25: "milestone_25",
  MILESTONE_50: "milestone_50",
  MILESTONE_75: "milestone_75",
  MILESTONE_100: "milestone_100",
  MILESTONE_150: "milestone_150",
  MILESTONE_200: "milestone_200",
  HAT_TRICK: "hat_trick",
  FIVE_WICKETS: "five_wickets",
  PLAYER_OF_MATCH: "player_of_match",
} as const;

export type MediaKey = (typeof MEDIA_KEYS)[keyof typeof MEDIA_KEYS];

// Try photo → video → animation → text
async function trySendMedia(
  sendPhoto: () => Promise<unknown>,
  sendVideo: () => Promise<unknown>,
  sendAnimation: () => Promise<unknown>,
  sendText: () => Promise<unknown>,
): Promise<void> {
  try {
    await sendPhoto();
    return;
  } catch (e1) {
    logger.debug({ err: e1 }, "sendPhoto failed, trying video");
  }
  try {
    await sendVideo();
    return;
  } catch (e2) {
    logger.debug({ err: e2 }, "sendVideo failed, trying animation");
  }
  try {
    await sendAnimation();
    return;
  } catch (e3) {
    logger.debug({ err: e3 }, "sendAnimation failed, falling back to text");
  }
  await sendText();
}

// Send to current ctx chat
export async function sendWithMedia(
  ctx: Context,
  mediaKey: string,
  text: string,
  extra?: Record<string, unknown>,
) {
  const fileId = await getRandomMediaFileId(mediaKey);
  if (fileId) {
    await trySendMedia(
      () => ctx.replyWithPhoto(fileId, { caption: text, parse_mode: "HTML", ...(extra ?? {}) }),
      () => ctx.replyWithVideo(fileId, { caption: text, parse_mode: "HTML", ...(extra ?? {}) }),
      () => ctx.replyWithAnimation(fileId, { caption: text, parse_mode: "HTML", ...(extra ?? {}) }),
      () => ctx.reply(text, { parse_mode: "HTML", ...(extra ?? {}) } as Parameters<Context["reply"]>[1]),
    );
    return;
  }
  await ctx.reply(text, { parse_mode: "HTML", ...(extra ?? {}) } as Parameters<Context["reply"]>[1]);
}

// Send to a specific chat by ID (for DM → group notification)
export async function sendWithMediaToChat(
  api: Api,
  chatId: string,
  mediaKey: string,
  text: string,
  extra?: Record<string, unknown>,
) {
  const fileId = await getRandomMediaFileId(mediaKey);
  if (fileId) {
    await trySendMedia(
      () => api.sendPhoto(chatId, fileId, { caption: text, parse_mode: "HTML", ...(extra ?? {}) }),
      () => api.sendVideo(chatId, fileId, { caption: text, parse_mode: "HTML", ...(extra ?? {}) }),
      () => api.sendAnimation(chatId, fileId, { caption: text, parse_mode: "HTML", ...(extra ?? {}) }),
      () => api.sendMessage(chatId, text, { parse_mode: "HTML", ...(extra ?? {}) } as Parameters<Api["sendMessage"]>[2]),
    );
    return;
  }
  await api.sendMessage(chatId, text, { parse_mode: "HTML", ...(extra ?? {}) } as Parameters<Api["sendMessage"]>[2]);
}
