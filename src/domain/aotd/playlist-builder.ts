import type {
  AotdAnalysis,
  AotdPlan,
  AotdPlaylist,
  AotdQuestionnaireAnswers,
  AotdShareCard,
  PlaylistEntry,
  RetrievalCandidate,
} from "./types.js";

const PLAYLIST_TRACK_LIMIT = 5;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickVariant(key: string, variants: string[]): string {
  return variants[hashString(key) % variants.length];
}

function buildPlaylistTitle(plan: AotdPlan): string {
  return `AOTD | ${plan.emotionalNeed}的${plan.emotionalImagery}`;
}

function buildPlaylistSubtitle(plan: AotdPlan): string {
  return pickVariant(`${plan.consumptionSource}|${plan.emotionalNeed}|subtitle`, [
    `从${plan.consumptionSource}出发，把今晚慢慢带向${plan.emotionalNeed}`,
    `把${plan.consumptionSource}翻译成一张更靠近${plan.emotionalNeed}的歌单`,
    `今晚这张歌单，想陪你从${plan.consumptionSource}走到${plan.emotionalNeed}`,
  ]);
}

function buildTrackReason(candidate: RetrievalCandidate, plan: AotdPlan): string {
  const matched = candidate.matchedSignals.slice(0, 3).join("、");
  if (matched) {
    return pickVariant(`${candidate.song.id}|${plan.emotionalNeed}|reason`, [
      `它贴合你此刻的${plan.emotionalImagery}氛围，也承接了“${matched}”这些状态信号。`,
      `它像是把“${matched}”这几层状态，安放进了${plan.emotionalImagery}这类场景里。`,
      `它不是只在说情绪，而是在用“${matched}”这些线索，把你往${plan.emotionalNeed}那边带。`,
    ]);
  }

  return pickVariant(`${candidate.song.id}|fallback-reason`, [
    `它适合作为“${plan.emotionalNeed}”这条歌单里的情绪底色。`,
    `它更像这张歌单里的过渡层，负责把气氛慢慢带到“${plan.emotionalNeed}”。`,
    `它会把整张歌单的空气感先铺出来，让你更自然地靠近${plan.emotionalNeed}。`,
  ]);
}

function buildHitLine(plan: AotdPlan): string {
  const mood = plan.moodSignals[0] || plan.consumptionSource;
  const objective = plan.objectiveSignals[0] || plan.emotionalNeed;
  return pickVariant(`${plan.consumptionSource}|${plan.emotionalNeed}|${plan.emotionalImagery}|hit`, [
    `今天的你，表面是在回答三道题，实际上是在告诉我：你想把“${mood}”慢慢带去“${objective}”。`,
    `从你的选择里能看出来，你不是随便想听歌，而是在替今晚找一个能承接“${plan.emotionalNeed}”的空间。`,
    `你选中的不是几个孤立标签，而是一条很明确的路径：从${plan.consumptionSource}出发，在${plan.emotionalImagery}里慢慢走向${plan.emotionalNeed}。`,
  ]);
}

export function buildAotdAnalysis(plan: AotdPlan): AotdAnalysis {
  return {
    todayState: plan.todayStateSummary,
    hitLine: buildHitLine(plan),
    recommendationLogic: plan.playlistStrategy,
  };
}

export function buildAotdPlaylist(plan: AotdPlan, candidates: RetrievalCandidate[]): AotdPlaylist {
  const tracks: PlaylistEntry[] = candidates.slice(0, PLAYLIST_TRACK_LIMIT).map((candidate, index) => ({
    rank: index + 1,
    song: candidate.song,
    reason: buildTrackReason(candidate, plan),
    score: candidate.score,
  }));

  return {
    title: buildPlaylistTitle(plan),
    subtitle: buildPlaylistSubtitle(plan),
    description: pickVariant(`${plan.consumptionSource}|${plan.emotionalImagery}|description`, [
      `围绕“${plan.consumptionSource} -> ${plan.emotionalNeed} -> ${plan.emotionalImagery}”生成的今日歌单。`,
      `这张歌单会先承接${plan.consumptionSource}，再把你轻轻带向${plan.emotionalNeed}，最终落在${plan.emotionalImagery}这层气氛里。`,
      `它不是简单按标签拼歌，而是想让今晚从${plan.consumptionSource}自然过渡到${plan.emotionalNeed}。`,
    ]),
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
    subtitle: pickVariant(`${answers.consumptionSource}|share-subtitle`, [
      `今天的我，从“${answers.consumptionSource}”走向“${answers.emotionalNeed}”`,
      `今晚的我，想在“${answers.emotionalImagery}”里靠近“${answers.emotionalNeed}”`,
      `这一晚，我想把${answers.consumptionSource}慢慢翻译成${answers.emotionalNeed}`,
    ]),
    caption: pickVariant(`${answers.emotionalImagery}|share-caption`, [
      `${plan.todayStateSummary} 今天这张歌单，想把我放进${answers.emotionalImagery}的空气里。`,
      `${plan.todayStateSummary} 所以我把今晚交给了一张更靠近${answers.emotionalImagery}的歌单。`,
      `${plan.todayStateSummary} 这一次，我想用${answers.emotionalImagery}的氛围把自己慢慢接住。`,
    ]),
    tags: [answers.consumptionSource, answers.emotionalNeed, answers.emotionalImagery],
  };
}
