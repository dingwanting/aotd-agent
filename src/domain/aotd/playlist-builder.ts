import type {
  AotdAnalysis,
  AotdPlan,
  AotdPlaylist,
  AotdQuestionnaireAnswers,
  AotdShareCard,
  PlaylistEntry,
  RetrievalCandidate,
} from "./types.js";

function buildPlaylistTitle(plan: AotdPlan): string {
  return `AOTD | ${plan.emotionalNeed}的${plan.emotionalImagery}`;
}

function buildPlaylistSubtitle(plan: AotdPlan): string {
  return `${plan.consumptionSource}之后，给今天的你一点${plan.emotionalNeed}`;
}

function buildTrackReason(candidate: RetrievalCandidate, plan: AotdPlan): string {
  const matched = candidate.matchedSignals.slice(0, 3).join("、");
  return matched
    ? `它贴合你此刻的${plan.emotionalImagery}氛围，也承接了“${matched}”这些状态信号。`
    : `它适合作为“${plan.emotionalNeed}”这条歌单里的情绪底色。`;
}

function buildHitLine(plan: AotdPlan): string {
  return `今天的你被${plan.consumptionSource}磨掉了很多余量，此刻真正想靠近的，是在${plan.emotionalImagery}里慢慢走向${plan.emotionalNeed}。`;
}

export function buildAotdAnalysis(plan: AotdPlan): AotdAnalysis {
  return {
    todayState: plan.todayStateSummary,
    hitLine: buildHitLine(plan),
    recommendationLogic: plan.playlistStrategy,
  };
}

export function buildAotdPlaylist(plan: AotdPlan, candidates: RetrievalCandidate[]): AotdPlaylist {
  const tracks: PlaylistEntry[] = candidates.slice(0, 8).map((candidate, index) => ({
    rank: index + 1,
    song: candidate.song,
    reason: buildTrackReason(candidate, plan),
    score: candidate.score,
  }));

  return {
    title: buildPlaylistTitle(plan),
    subtitle: buildPlaylistSubtitle(plan),
    description: `围绕“${plan.consumptionSource} -> ${plan.emotionalNeed} -> ${plan.emotionalImagery}”生成的今日歌单。`,
    tracks,
  };
}

export function buildAotdShareCard(
  answers: AotdQuestionnaireAnswers,
  plan: AotdPlan,
  playlist: AotdPlaylist,
): AotdShareCard {
  return {
    title: playlist.title,
    subtitle: `今天的我，从“${answers.consumptionSource}”走向“${answers.emotionalNeed}”`,
    caption: `${plan.todayStateSummary} 今天这张歌单，想把我放进${answers.emotionalImagery}的空气里。`,
    tags: [answers.consumptionSource, answers.emotionalNeed, answers.emotionalImagery],
  };
}
