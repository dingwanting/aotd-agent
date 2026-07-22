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

// 感受桶：把 plan 文本里的关键词映射到 7 个心境桶
// 注意：只用"特异性"高的词，"继续 / 重新"等常见副词不能进 recharge 桶，否则"被看见继续留住"这种 happy plan 会被错分
// 优先级：companion > release > recharge > celebrate > explore > stillness > warmth
const FEELING_BUCKETS: ReadonlyArray<{ id: string; keywords: ReadonlyArray<string> }> = [
  { id: "companion", keywords: ["陪伴", "有人陪", "被接住", "不孤单", "被理解", "靠岸", "陪一程", "被陪伴", "陪你", "身边"] },
  { id: "release", keywords: ["放下", "排气", "透气", "松开", "不再撑", "软下来", "紧绷", "拉扯", "压力", "过载", "松一松", "缓一口", "透口气", "撑住", "扛住", "松弛"] },
  { id: "recharge", keywords: ["蓄力", "回血", "充电", "重启", "重新出发", "重新上路", "脚踩实", "找回来", "再攒一攒", "满格", "电量"] },
  { id: "celebrate", keywords: ["开心", "奖励", "庆祝", "被看见", "被认可", "发亮", "上头", "被认领", "上光", "发光", "上扬", "轻盈", "发光的", "好心情", "高光", "甜", "被夸"] },
  { id: "explore", keywords: ["好奇", "探索", "新鲜", "试试", "打开", "走远", "看世界", "可能性", "再走一步", "出门", "新地方"] },
  { id: "stillness", keywords: ["安静", "独处", "留白", "不打扰", "自己待", "停一停", "喘", "不被看见"] },
  { id: "warmth", keywords: ["温暖", "安心", "暖意", "柔光", "柔", "刚刚好"] },
];

const FEELING_TAGS: Record<string, string[]> = {
  companion: ["被温柔托住", "靠岸一会儿", "有人接着", "你不孤单", "陪一程再说", "被接住的"],
  release: ["先把紧绷松开", "让空气软下来", "不再硬撑", "缓一口气", "情绪透透气", "先放一放"],
  recharge: ["慢慢回来", "重新上路", "蓄力中", "脚踩实一点", "再攒一攒", "回到自己"],
  celebrate: ["把这点开心放大", "轻盈上扬", "被认领的瞬间", "继续亮着", "我值得这束光", "好心情继续"],
  explore: ["想去远一点", "好奇心还在", "把世界打开一点", "再走一步", "试试看", "新鲜感在敲门"],
  stillness: ["安静才安全", "和我自己待一会儿", "不被打扰", "留一点空间", "停一停也好", "安静陪一程"],
  warmth: ["被暖意包住", "温度刚刚好", "柔光一束", "你被接住了", "暖一点", "被温柔接住"],
};

function detectFeelingBucket(plan: AotdPlan): string {
  const haystack = [
    plan.consumptionSource,
    plan.emotionalNeed,
    plan.emotionalImagery,
    plan.userIntent,
    plan.todayStateSummary,
    ...(plan.moodSignals || []),
    ...(plan.objectiveSignals || []),
    ...(plan.constraints || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const bucket of FEELING_BUCKETS) {
    if (bucket.keywords.some((keyword) => haystack.includes(keyword))) {
      return bucket.id;
    }
  }
  return "stillness";
}

function buildTrackMoodTag(candidate: RetrievalCandidate, plan: AotdPlan): string {
  const bucket = detectFeelingBucket(plan);
  const variants = FEELING_TAGS[bucket] || FEELING_TAGS.stillness;
  // 同歌 + 同心境 = 同文案（确定性，便于用户"被认领"的感觉稳定）
  return pickVariant(`${candidate.song.id}|${bucket}|mood`, variants);
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
    moodTag: buildTrackMoodTag(candidate, plan),
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
