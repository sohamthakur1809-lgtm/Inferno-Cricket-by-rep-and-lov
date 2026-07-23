import type { Player, Match } from "@workspace/db";

export function mention(name: string, id: string) {
  return `<a href="tg://user?id=${id}">${escHtml(name)}</a>`;
}

export function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function strikeRate(runs: number, balls: number) {
  if (!balls) return "0.00";
  return ((runs / balls) * 100).toFixed(2);
}

export function economy(runs: number, balls: number) {
  if (!balls) return "0.00";
  return ((runs / balls) * 6).toFixed(2);
}

export function battingAvg(runs: number, matches: number) {
  if (!matches) return "0.00";
  return (runs / matches).toFixed(2);
}

export function bowlingAvg(runs: number, wickets: number) {
  if (!wickets) return "—";
  return (runs / wickets).toFixed(2);
}

export function bowlingSR(balls: number, wickets: number) {
  if (!wickets) return "—";
  return (balls / wickets).toFixed(2);
}

const SEP = `────┈┄┄╌╌╌╌┄┄┈────`;
const OMNIDAI = `✨ ~OmniDAi™`;

function playerTier(matches: number): string {
  if (matches >= 1500) return "👑 Legend";
  if (matches >= 901) return "💎 Diamond";
  if (matches >= 601) return "🥇 Gold II";
  if (matches >= 401) return "🥇 Gold I";
  if (matches >= 201) return "🥈 Silver II";
  if (matches >= 101) return "🥈 Silver I";
  if (matches >= 51) return "🥉 Bronze II";
  if (matches >= 26) return "🥉 Bronze I";
  if (matches >= 11) return "🪵 Rookie II";
  return "🪵 Rookie I";
}

export function formatScore(match: Match) {
  const inn = match.currentInnings;
  const battingTeam = match.battingTeam === "A" ? match.teamAName : match.teamBName;
  const bowlingTeam = match.battingTeam === "A" ? match.teamBName : match.teamAName;
  const score = inn === 1 ? match.innings1Score : match.innings2Score;
  const wkts = inn === 1 ? match.innings1Wickets : match.innings2Wickets;
  const balls = inn === 1 ? match.innings1Balls : match.innings2Balls;
  const over = Math.floor(balls / 6);
  const b = balls % 6;
  let txt = `🏏 <b>LIVE SCORE</b>\n\n`;
  txt += `<b>${escHtml(battingTeam ?? "Batting")}</b> vs <b>${escHtml(bowlingTeam ?? "Bowling")}</b>\n\n`;
  txt += `📊 ${escHtml(battingTeam ?? "Batting")}: <b>${score}/${wkts}</b> (${over}.${b} ov)`;
  if (inn === 2 && match.target) {
    const needed = match.target - score;
    const ballsLeft = (match.overs! * 6) - balls;
    txt += `\n🎯 Target: ${match.target} | Need: ${needed} off ${ballsLeft} balls`;
  }
  return txt;
}

export function formatUserInfo(p: Player): string {
  const sr = strikeRate(p.totalRuns, p.totalBallsFaced);
  const eco = economy(p.totalRunsConceded, p.totalBallsBowled);
  const avg = battingAvg(p.totalRuns, p.matchesPlayed);
  const bowlAvg = bowlingAvg(p.totalRunsConceded, p.totalWickets);
  const bowlSR = bowlingSR(p.totalBallsBowled, p.totalWickets);
  const winRate = p.matchesPlayed > 0 ? ((p.wins / p.matchesPlayed) * 100).toFixed(1) : "0.0";
  const tier = playerTier(p.matchesPlayed);
  const today = new Date().toISOString().split("T")[0];
  const performance = p.totalRuns + p.totalWickets * 20;

  return (
    `🏏 <b>𝗖𝗔𝗥𝗘𝗘𝗥 𝗣𝗥𝗢𝗙𝗜𝗟𝗘</b>\n` +
    `${SEP}\n` +
    `👤 Player: <b>${escHtml(p.firstName)}</b>${p.username ? ` (@${escHtml(p.username)})` : ""}\n` +
    `🎖️ Tier: <b>${tier}</b>\n` +
    `🆔 ID: <code>${p.telegramId}</code>\n` +
    `${SEP}\n\n` +
    `🏆 <b>𝗠𝗔𝗧𝗖𝗛 𝗔𝗪𝗔𝗥𝗗𝗦</b>\n` +
    `🟠 Orange Cap ×${p.orangeCaps}  •  🟣 Purple Cap ×${p.purpleCaps}  •  🌟 POTM ×${p.mvpAwards}\n\n` +
    `📊 <b>𝗢𝗩𝗘𝗥𝗔𝗟𝗟 𝗦𝗧𝗔𝗧𝗦</b>\n` +
    `🎮 Matches: <b>${p.matchesPlayed}</b>  |  🏆 Highest: <b>${p.highestScore}</b>\n` +
    `📈 Performance Score: <b>${performance}</b>\n` +
    `${SEP}\n\n` +
    `🏏 <b>𝗕𝗔𝗧𝗧𝗜𝗡𝗚</b>\n` +
    `🏃 Runs: <b>${p.totalRuns}</b>  |  📈 Avg: <b>${avg}</b>\n` +
    `⚡ S/R: <b>${sr}</b>\n` +
    `💥 6s: <b>${p.totalSixes}</b>  •  4s: <b>${p.totalFours}</b>\n` +
    `🔥 100s: <b>${p.hundreds}</b>  •  50s: <b>${p.fifties}</b>  •  200s: <b>${p.twoHundreds}</b>\n` +
    `🦆 Ducks: <b>${p.ducks}</b>\n` +
    `${SEP}\n\n` +
    `🎯 <b>𝗕𝗢𝗪𝗟𝗜𝗡𝗚</b>\n` +
    `⚾ Wickets: <b>${p.totalWickets}</b>\n` +
    `🎯 Econ: <b>${eco}</b>  |  📈 Avg: <b>${bowlAvg}</b>\n` +
    `⚡ S/R: <b>${bowlSR}</b>\n` +
    `🎩 Hat-Tricks: <b>${p.hatTricks}</b>  |  Best: <b>${p.bestBowlingWickets}/${p.bestBowlingRuns}</b>\n` +
    `${SEP}\n\n` +
    `🧢 <b>𝗟𝗘𝗔𝗗𝗘𝗥𝗦𝗛𝗜𝗣</b>\n` +
    `📈 Win Rate: <b>${winRate}%</b>\n` +
    `✅ Wins: <b>${p.wins}</b>  |  ❌ Losses: <b>${p.losses}</b>\n` +
    `🔥 Best Streak: <b>${p.longestWinStreak}</b>\n` +
    `${SEP}\n` +
    `<i>#CricInferno  |  ${today}</i>\n` +
    `<i>${OMNIDAI}</i>`
  );
}

export function soloLobbyText(
  players: { id: string; name: string }[],
  spellLength: number,
): string {
  const list = players
    .map((p, i) => `${i + 1}. ${escHtml(p.name)}`)
    .join("\n");
  return (
    `🏏 <b>𝗖𝗥𝗜𝗖 𝗜𝗡𝗙𝗘𝗥𝗡𝗢 — Solo Lobby</b>\n` +
    `${SEP}\n` +
    `⚡ Spell: <b>${spellLength} balls</b> per bowler\n` +
    `🎯 Format: Each player bats until OUT\n` +
    `🔄 Bowlers rotate every ${spellLength} balls\n\n` +
    `<b>Players (${players.length}):</b>\n${list || "None yet"}\n\n` +
    `✅ /joinsolo to join  |  Min 2 players\n` +
    `${SEP}`
  );
}

export function teamLobbyText(
  teamA: { id: string; name: string }[],
  teamB: { id: string; name: string }[],
  hostName?: string,
): string {
  const fmtTeam = (arr: { id: string; name: string }[]) =>
    arr.length ? arr.map((p, i) => `  ${i + 1}. ${escHtml(p.name)}`).join("\n") : "  Empty";
  let txt = `🏏 <b>𝗧𝗘𝗔𝗠 𝗟𝗢𝗕𝗕𝗬</b>\n${SEP}\n`;
  if (hostName) txt += `👑 Host: <b>${escHtml(hostName)}</b>\n${SEP}\n`;
  txt += `\n🔵 <b>TEAM A</b> (${teamA.length} players)\n${fmtTeam(teamA)}\n\n`;
  txt += `🔴 <b>TEAM B</b> (${teamB.length} players)\n${fmtTeam(teamB)}\n\n`;
  txt += `${SEP}`;
  return txt;
}

export function membersText(match: Match): string {
  type P = { id: string; name: string };
  const teamA = (match.teamAPlayers as P[]) ?? [];
  const teamB = (match.teamBPlayers as P[]) ?? [];
  const teamAOrder = (match.teamABattingOrder as P[]) ?? [];
  const teamBOrder = (match.teamBBattingOrder as P[]) ?? [];
  const currentStriker = match.currentStrikerId;
  const currentBowler = match.currentBowlerId;

  const statusIcon = (p: P, team: "A" | "B"): string => {
    if (p.id === currentStriker) return "🏏";
    if (p.id === currentBowler) return "⚾";
    const order = team === "A" ? teamAOrder : teamBOrder;
    const idx = team === "A" ? match.teamABattingIndex : match.teamBBattingIndex;
    const orderIdx = order.findIndex((o) => o.id === p.id);
    if (orderIdx >= 0 && orderIdx < idx) return "❌";
    return "•";
  };

  const fmtTeam = (arr: P[], team: "A" | "B", capId: string | null | undefined) =>
    arr.length
      ? arr.map((p, i) => `  ${i + 1}. ${statusIcon(p, team)} ${escHtml(p.name)}${p.id === capId ? " 👑" : ""}`).join("\n")
      : "  Empty";

  const scoreA = match.battingTeam === "A" && match.currentInnings === 1
    ? match.innings1Score : match.battingTeam === "B" && match.currentInnings === 2
    ? match.innings2Score : match.innings1Score;
  const wktsA = match.innings1Wickets;
  const scoreB = match.battingTeam === "B" && match.currentInnings === 1
    ? match.innings1Score : match.battingTeam === "A" && match.currentInnings === 2
    ? match.innings2Score : match.innings2Score;
  const wktsB = match.innings2Wickets;
  const ballsA = match.innings1Balls;
  const ballsB = match.innings2Balls;
  const ovA = `${Math.floor(ballsA / 6)}.${ballsA % 6}`;
  const ovB = `${Math.floor(ballsB / 6)}.${ballsB % 6}`;

  const statusLabel = match.status === "live" ? "🏏 Match in Progress" : match.status === "lobby" ? "🏟 Lobby" : match.status === "finished" ? "🏁 Finished" : `📋 ${match.status}`;

  let txt = `📊 <b>𝗠𝗔𝗧𝗖𝗛 𝗢𝗩𝗘𝗥𝗩𝗜𝗘𝗪</b>\n${SEP}\n`;
  if (match.hostId) txt += `👑 Host: <b>${match.hostId}</b>\n`;
  txt += `⏳ Overs: <b>${match.overs ?? "TBD"}</b>  |  📍 ${statusLabel}\n`;
  txt += `${SEP}\n\n`;
  txt += `🔵 <b>${escHtml(match.teamAName ?? "TEAM A")}</b> — ${scoreA}/${wktsA} (${ovA} ov)\n`;
  txt += `╰⊚ ${match.battingTeam === "A" ? "𝗕𝗮𝘁𝘁𝗶𝗻𝗴" : "𝗕𝗼𝘄𝗹𝗶𝗻𝗴"}\n`;
  txt += `${fmtTeam(teamA, "A", match.teamACaptainId)}\n\n`;
  txt += `🔴 <b>${escHtml(match.teamBName ?? "TEAM B")}</b> — ${scoreB}/${wktsB} (${ovB} ov)\n`;
  txt += `╰⊚ ${match.battingTeam === "B" ? "𝗕𝗮𝘁𝘁𝗶𝗻𝗴" : "𝗕𝗼𝘄𝗹𝗶𝗻𝗴"}\n`;
  txt += `${fmtTeam(teamB, "B", match.teamBCaptainId)}\n`;
  txt += `${SEP}\n<i>#CricInferno | ${OMNIDAI}</i>`;
  return txt;
}

export function soloScorecardText(
  players: Array<{
    id: string; name: string; runs: number; wickets: number;
    ballsFaced: number; ballsBowled: number; fours: number; sixes: number; out: boolean; eliminated?: boolean;
  }>,
): string {
  const sorted = [...players].sort((a, b) => b.runs - a.runs);
  const topScorer = sorted[0]!;
  const byWickets = [...players].sort((a, b) => b.wickets - a.wickets);
  const topBowler = byWickets[0]!;
  const totalRuns = players.reduce((s, p) => s + p.runs, 0);
  const totalBalls = players.reduce((s, p) => s + p.ballsFaced, 0);
  const ovStr = `${Math.floor(totalBalls / 6)}.${totalBalls % 6}`;

  let txt = `≪━─━─━◈ 𝗦𝗼𝗹𝗼 𝗙𝗶𝗻𝗮𝗹 𝗦𝗰𝗼𝗿𝗲 ◈━─━─━≫\n\n`;
  for (const p of sorted) {
    const sr = p.ballsFaced > 0 ? ((p.runs / p.ballsFaced) * 100).toFixed(1) : "0.0";
    const eco = p.ballsBowled > 0 ? ((p.wickets > 0 || true) ? "—" : "—") : "—";
    const runsAllowed = players.filter((x) => x.id !== p.id).reduce((s, _) => s, 0);
    const ecoCalc = p.ballsBowled > 0 ? ((runsAllowed / p.ballsBowled) * 6).toFixed(1) : "0.0";
    const icon = p.eliminated ? "❌" : p.id === topScorer.id ? "❖" : "•";
    const statusNote = p.eliminated ? " [Timeout Eliminated]" : p.out ? " [OUT]" : " [Not Out]";
    txt += `${icon} <b>${escHtml(p.name)}</b> — <b>${p.runs}</b> (${p.ballsFaced})${statusNote}\n`;
    txt += `  ➥ 4️⃣: ${p.fours} | 6️⃣: ${p.sixes} ⟶ SR: ${sr}\n`;
    txt += `  ➥ Bowling: ${p.ballsBowled} balls | ${p.wickets} wkts | Eco: ${ecoCalc}\n\n`;
  }
  txt += `${SEP}\n\n`;
  txt += `🏏 Top Scorer: <b>${escHtml(topScorer.name)}</b> — ${topScorer.runs} (${topScorer.ballsFaced})\n`;
  txt += `🎯 Best Bowler: <b>${escHtml(topBowler.name)}</b> — ${topBowler.wickets} wkt(s)\n\n`;
  txt += `╰⊚ Total: <b>${totalRuns}</b> in ${ovStr} overs\n\n`;
  txt += `✨ GG!  |  #CricInferno  |  ${OMNIDAI}`;
  return txt;
}

export function runEmoji(runs: number) {
  if (runs === 0) return "⚫ DOT BALL";
  if (runs === 1) return "1️⃣ ONE";
  if (runs === 2) return "2️⃣ TWO";
  if (runs === 3) return "3️⃣ THREE";
  if (runs === 4) return "4️⃣ FOUR";
  if (runs === 5) return "5️⃣ FIVE";
  if (runs === 6) return "6️⃣ SIX! 🎉";
  return `${runs} RUNS`;
}
