function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

const OMNIDAI = `✨ <i>~OmniDAi™</i>`;
const SEP = `────┈┄┄╌╌╌╌┄┄┈────`;

export const commentary = {
  dot(): string {
    return pick([
      "😴 Dot ball! Is the bat even there?",
      "🥱 Absolute nothing. Zero. Zilch. Nada.",
      "🫥 Bowler sent a postcard and batter didn't reply.",
      "💤 That was... a swing and a miss at the air.",
      "😑 Dot ball. The crowd is questioning their life choices.",
      "🐢 At this rate, the snail in row 3 could score more.",
      "🤡 Grand attempt. Historic failure. 0 runs.",
      "📦 Delivered. Not collected. Return to sender.",
      "🧱 Bat met ball like a wall meets a feather — nothing happened.",
      "⚰️ RIP to that shot attempt. Gone too soon.",
      "🌑 Darkness. Void. Dot ball.",
    ]);
  },

  runs(n: number): string {
    if (n === 0) return commentary.dot();
    if (n === 1) return pick([
      "1️⃣ Singles club. Not very exclusive.",
      "1️⃣ One run! Bold strategy.",
      "1️⃣ A single. The batter lives to fight another ball.",
      "1️⃣ Minimum viable run. Economists would be proud.",
      "1️⃣ Snuck through for one. Bowler looks unimpressed.",
    ]);
    if (n === 2) return pick([
      "2️⃣ Two runs! They're warming up now.",
      "2️⃣ Couple of runs. Respectable, not exciting.",
      "2️⃣ Two! The bowler nods — expected this.",
      "2️⃣ Not bad! Two runs added to the tally.",
    ]);
    if (n === 3) return pick([
      "3️⃣ Three runs! That's actually rare. Document this.",
      "3️⃣ THREE! Unusual. Unexpected. Appreciated.",
      "3️⃣ The elusive three-run shot. A statistical anomaly.",
      "3️⃣ Triple! Did that just happen?",
    ]);
    if (n === 4) return pick([
      "4️⃣ FOUR! Boundary! Now we're talking!",
      "4️⃣ Four runs! The fielder dived — still went through.",
      "4️⃣ BOUNDARY! The bat finally woke up!",
      "4️⃣ Four! Crisp, clean, and right through the gap!",
      "4️⃣ FOUR RUNS! Now the bowler is sweating.",
    ]);
    if (n === 5) return pick([
      "5️⃣ FIVE?! How?! Nobody knows, but it happened!",
      "5️⃣ Five runs! Chaos theory applied to cricket.",
      "5️⃣ FIVE! The scoreboard is doing a double-take.",
      "5️⃣ Five runs — rarer than a solar eclipse in this game.",
    ]);
    if (n === 6) return pick([
      "6️⃣ SIX! MAXIMUM! OUT OF THE PARK! 🎉🔥",
      "6️⃣ HUGE SIX! The bowler's confidence left the chat!",
      "6️⃣ MAXIMUM! Ball hasn't landed yet. Possibly in orbit.",
      "6️⃣ SIX! The crowd goes absolutely wild! 🎇",
      "6️⃣ CHAKKA! That was not a cricket shot — that was an event!",
      "6️⃣ OVER THE FENCE! The bat just went supersonic!",
    ]);
    return `${n} runs!`;
  },

  wicket(batterName: string, bowlerName: string): string {
    return pick([
      `💀 OUT! ${batterName} matched ${bowlerName} — and the batter pays the price!`,
      `🪦 CLEAN BOWLED! ${batterName}, the pavilion is that way.`,
      `😂 ${batterName} thought "I'll go with this number"... so did ${bowlerName}. OUT!`,
      `🎯 ${bowlerName} set the trap. ${batterName} walked right in. Classic.`,
      `💥 ${batterName} OUT! Mind-reading level delivery from ${bowlerName}.`,
      `🤣 Same number! Both psychic, but only one wins. ${batterName} OUT!`,
      `⚡ WICKET! ${batterName} just donated their wicket to ${bowlerName}. Generous.`,
      `🏴‍☠️ ${bowlerName} confirmed as a mind reader. ${batterName} OUT!`,
      `💔 Tragic end for ${batterName}. ${bowlerName} celebrates — because they predicted it.`,
    ]);
  },

  hatTrick(bowlerName: string): string {
    return pick([
      `🎩 HAT-TRICK! ${bowlerName} has taken THREE in a row! Absolutely legendary! 🔥🔥🔥`,
      `🪄 THREE WICKETS IN A ROW! ${bowlerName} is literally psychic at this point!`,
      `👑 HAT-TRICK! ${bowlerName} — the group's official mind reader. Unreal!`,
      `🎩 ${bowlerName} just wrote history! HAT-TRICK! The group is losing their minds!`,
    ]);
  },

  milestone50(batter: string): string {
    return pick([
      `🥳 FIFTY! ${batter} hits 50 runs! Applause! 👏`,
      `🏅 HALF CENTURY by ${batter}! Impressive, considering the chaos around them.`,
      `🎊 50 RUNS! ${batter} is officially the dangerous one right now.`,
      `🌟 ${batter} reaches FIFTY! A beautiful innings!`,
    ]);
  },

  milestone100(batter: string): string {
    return pick([
      `🎯 CENTURY! ${batter} reaches 100 RUNS! UNBELIEVABLE! 🏆`,
      `💯 ONE HUNDRED! ${batter} — this innings will be talked about for ages!`,
      `🌟 SHATAKAM! ${batter} smashes a century!`,
      `🏆 100 RUNS by ${batter}! On a Telegram hand cricket bot. Still counts!`,
    ]);
  },

  milestone200(batter: string): string {
    return pick([
      `🚀 200 RUNS! ${batter} has gone full Sachin mode! UNSTOPPABLE!`,
      `💯💯 DOUBLE CENTURY! ${batter} — you need to be stopped.`,
      `🏆 200 UP! ${batter} is a menace. A beautiful, terrifying menace. Congrats!`,
    ]);
  },

  inningsBreak(batting: string, target: number): string {
    return pick([
      `🏏 <b>INNINGS BREAK!</b>\n\n${batting} need <b>${target} runs</b> to win.\n\nPressure? What pressure?`,
      `⚡ <b>INNINGS BREAK!</b>\n\nTarget: <b>${target}</b> runs.\n\n${batting} — can you handle the heat?`,
      `☕ <b>INNINGS BREAK!</b>\n\nTarget: <b>${target}</b> for ${batting}.\n\nThe bowlers are already plotting. Good luck.`,
    ]);
  },

  win(winner: string, margin: string): string {
    return pick([
      `🏆 <b>${winner} WINS</b> — ${margin}!\n\n🎉 Champions! The losers may now exit quietly.`,
      `🥇 <b>VICTORY for ${winner}!</b> ${margin}\n\n😎 GG. No re. GG.`,
      `🎊 <b>${winner} takes it!</b> ${margin}\n\n🔥 What a match! Up for a rematch?`,
      `👑 <b>${winner} — CHAMPIONS!</b> ${margin}\n\nThe opposition played their best. It just wasn't good enough.`,
    ]);
  },

  tie(): string {
    return pick([
      `🤝 <b>MATCH TIED!</b> Both teams equally matched — or equally chaotic. Either way, respect.`,
      `😐 <b>IT'S A TIE!</b> Nobody won. Nobody lost. The universe remains balanced.`,
      `⚖️ <b>MATCH TIED!</b> The cricket gods couldn't decide either. Fair enough.`,
    ]);
  },

  spamBlocked(num: number): string {
    return pick([
      `🚫 That's ${num} three times in a row! Spam-Free mode says NO. Try something else.`,
      `❌ Same number three times! Spam filter activated. Get creative, bowler!`,
      `🔒 Spam-Free mode: ${num} is LOCKED OUT. Pick a different number!`,
    ]);
  },

  bowlingPrompt(bowlerMention: string, _batterMention: string, ball: number, total: number, mode: "solo" | "team"): string {
    const header = mode === "solo" ? "🏟️ 𝗦𝗢𝗟𝗢 𝗗𝗘𝗟𝗜𝗩𝗘𝗥𝗬" : "🏟️ 𝗧𝗘𝗔𝗠 𝗗𝗘𝗟𝗜𝗩𝗘𝗥𝗬";
    return (
      `${header}\n` +
      `${SEP}\n` +
      `🎯 ${bowlerMention} is up to bowl!\n` +
      `📩 Check your PM to deliver! <b>(Ball ${ball}/${total})</b>`
    );
  },

  battingPrompt(batterMention: string, ball: number, total: number, mode: "solo" | "team"): string {
    const range = mode === "solo" ? "1–6" : "0–6";
    return (
      `⚾ <b>Ball Delivered!</b>  ·  Ball: <b>${ball} / ${total}</b>\n` +
      `🏏 ${batterMention}, choose your shot! (${range})`
    );
  },

  bowlerDmPrompt(batterName: string, ball: number, total: number): string {
    return (
      `🏏 <b>𝗬𝗢𝗨𝗥 𝗧𝗨𝗥𝗡 𝗧𝗢 𝗕𝗢𝗪𝗟!</b>\n` +
      `${SEP}\n` +
      `👤 Batter: <b>${batterName}</b>\n` +
      `🔢 Send a number (1–6) here to bowl.\n` +
      `${SEP}\n` +
      `🎯 Ball: <b>${ball} / ${total}</b>`
    );
  },

  afkWarn50(playerName: string, role: "bowler" | "batter"): string {
    const action = role === "bowler" ? "send your number in DM" : "choose your shot";
    return `⏰ <b>AFK Warning!</b>\n\n${playerName}, you have <b>40 seconds</b> left to ${action}! Hurry up!`;
  },

  afkWarn30(playerName: string): string {
    return `⚠️ <b>FINAL WARNING!</b>\n\n${playerName}, <b>40 seconds</b> left! Act now!`;
  },

  afkTimeout(playerName: string, role: "bowler" | "batter"): string {
    const desc = role === "bowler" ? "eliminated — random number bowled!" : "ELIMINATED from the match!";
    return `🤖 <b>AFK Timeout!</b>\n\n${playerName} went AFK and has been ${desc}`;
  },

  afkPenaltyTeam(playerName: string, role: "bowler" | "batter", penalty: number): string {
    if (role === "bowler") {
      return (
        `🚨 <b>AFK PENALTY!</b>\n\n` +
        `${playerName} (bowler) went AFK!\n` +
        `💸 Batting team awarded <b>${penalty} penalty runs</b>\n` +
        `🔄 Bowling captain must select a new bowler for remaining balls!`
      );
    }
    return (
      `🚨 <b>AFK PENALTY!</b>\n\n` +
      `${playerName} (batter) went AFK!\n` +
      `💀 <b>AUTO WICKET!</b> — batter is OUT!\n` +
      `💸 Batting team loses <b>${penalty} runs</b> as penalty!`
    );
  },

  soloEliminated(playerName: string): string {
    return (
      `🚫 <b>ELIMINATED!</b>\n\n` +
      `${playerName} went AFK and has been removed from the match!\n` +
      `Next player bats...`
    );
  },

  overSummary(overNumber: number, runs: number, wickets: number, batterName: string, bowlerName: string): string {
    return (
      `📊 <b>Over ${overNumber} Summary</b>\n` +
      `${SEP}\n` +
      `🏃 Runs: <b>${runs}</b>  |  💀 Wickets: <b>${wickets}</b>\n` +
      `🏏 Batter: ${batterName}  |  🎯 Bowler: ${bowlerName}\n` +
      `${SEP}\n` +
      `${OMNIDAI}`
    );
  },

  aiMatchSummary(
    teamAName: string, scoreA: number, wktsA: number,
    teamBName: string, scoreB: number, wktsB: number,
    winner: string, margin: string,
    topBatter: string, topBatterRuns: number,
    topBowler: string, topBowlerWkts: number,
    overs: number,
  ): string {
    const drama = scoreA + scoreB > 100 ? "high-scoring thriller" : scoreA === scoreB ? "nail-biting tie" : "competitive clash";
    const result = winner ? `${winner} clinched the win ${margin}` : "the match ended in a tie";
    return (
      `🎙️ <b>OmniDAi™ Match Summary</b>\n` +
      `${SEP}\n\n` +
      `It was a ${drama} as ${escHtml(teamAName)} faced ${escHtml(teamBName)} in a ${overs}-over encounter.\n\n` +
      `${escHtml(teamAName)} posted <b>${scoreA}/${wktsA}</b> while ${escHtml(teamBName)} replied with <b>${scoreB}/${wktsB}</b>.\n\n` +
      `In the end, ${result}.\n\n` +
      `🏏 Player of the Match: <b>${escHtml(topBatter)}</b> (${topBatterRuns} runs)\n` +
      `🎯 Best Bowler: <b>${escHtml(topBowler)}</b> (${topBowlerWkts} wkts)\n\n` +
      `${SEP}\n` +
      `${OMNIDAI} | #CricInferno`
    );
  },

  soloOmniSummary(topScorer: string, topScorerRuns: number, totalRuns: number, balls: number): string {
    const sr = balls > 0 ? ((totalRuns / balls) * 100).toFixed(0) : "0";
    return (
      `🎙️ <b>OmniDAi™ Analysis</b>\n` +
      `${SEP}\n` +
      `⚡ Match run rate: <b>${sr}</b>  |  Total: <b>${totalRuns}</b> runs\n` +
      `🏏 Standout: <b>${escHtml(topScorer)}</b> with ${topScorerRuns} runs\n` +
      `${OMNIDAI}`
    );
  },
};

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
