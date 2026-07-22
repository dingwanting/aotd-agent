import type { AotdPlan, RetrievalCandidate, SongDocument } from "./types.js";

interface KeywordRule {
  keywords: string[];
  values: string[];
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function tokenize(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(/[\s,/|、】【（）()]+/g))
    .map(normalizeToken)
    .filter(Boolean);
}

function containsAny(source: string[], candidates: string[]): string[] {
  const sourceTokens = tokenize(source);
  const candidateTokens = tokenize(candidates);
  return [...new Set(candidateTokens.filter((token) => sourceTokens.includes(token)))];
}

function buildRuleJoinedText(plan: AotdPlan): string {
  return [
    plan.consumptionSource,
    plan.emotionalNeed,
    plan.emotionalImagery,
    plan.userIntent,
    plan.todayStateSummary,
    ...plan.moodSignals,
    ...plan.sceneSignals,
    ...plan.objectiveSignals,
    ...plan.constraints,
    ...plan.queryHints,
  ]
    .join(" ")
    .toLowerCase();
}

function collectRuleValues(joined: string, rules: KeywordRule[]): string[] {
  const values: string[] = [];
  for (const rule of rules) {
    if (rule.keywords.some((keyword) => joined.includes(keyword.toLowerCase()))) {
      values.push(...rule.values);
    }
  }
  return [...new Set(values)];
}

const CANONICAL_NEED_RULES: KeywordRule[] = [
  {
    keywords: ["放松", "回暖", "卸力", "缓下来", "轻轻放松", "低噪休息", "慢下来", "热水", "毯子"],
    values: ["Recovery"],
  },
  {
    keywords: ["陪伴", "有人分享", "有人陪伴", "被接住", "并肩", "不孤单", "分享", "找人聊天", "热可可"],
    values: ["Companion"],
  },
  {
    keywords: ["整理", "留白", "回看", "回味", "想明白", "清空大脑", "放空", "reflection"],
    values: ["Reflection"],
  },
  {
    keywords: ["透气", "抽离", "逃离", "往外看看", "撤离", "想躲开"],
    values: ["Escape"],
  },
  {
    keywords: ["找回力量", "重新启动", "提气", "往前走", "抬头", "继续充电", "推进", "成就感"],
    values: ["Growth"],
  },
  {
    keywords: ["奖励", "开心", "庆祝", "被认可", "把开心放大", "继续开心", "继续发光", "小庆祝", "烟花", "发亮"],
    values: ["Celebrate"],
  },
  {
    keywords: ["探索", "好奇", "新鲜", "想点开", "去探索一下", "满足一点好奇", "探索新鲜", "展览", "书店"],
    values: ["Explore"],
  },
];

const NEED_TOKEN_EXPANSIONS: Record<string, string[]> = {
  Recovery: ["Recovery", "healing", "recovery", "放松", "回暖", "卸力", "缓下来", "轻轻放松", "低噪"],
  Companion: ["Companion", "companion", "陪伴", "被接住", "并肩", "不孤单", "分享", "有人陪伴", "有人分享"],
  Reflection: ["Reflection", "reflection", "整理", "留白", "回看", "想明白", "清空大脑", "放空"],
  Escape: ["Escape", "escape", "透气", "抽离", "逃离", "走出去", "漫游"],
  Growth: ["Growth", "growth", "提气", "重新启动", "往前走", "抬头", "找回力量", "继续发光"],
  Celebrate: ["Celebrate", "celebrate", "奖励", "开心", "庆祝", "被认可", "发光", "上头"],
  Explore: ["Explore", "explore", "探索", "好奇", "新鲜", "想点开", "满足好奇", "城市漫游"],
};

const CANONICAL_SCENE_RULES: KeywordRule[] = [
  { keywords: ["雨夜", "窗边", "挂在车窗", "微凉带雨气"], values: ["Tokyo Rain"] },
  { keywords: ["海边", "海风", "公路", "副驾驶", "兜风"], values: ["Beach Road"] },
  { keywords: ["散步", "晚风", "路边长椅", "夜跑", "河边", "操场"], values: ["Late Walk", "Riverside Run"] },
  { keywords: ["城市", "霓虹", "高楼", "街灯", "商场", "天台", "夜市", "灯串"], values: ["City Night", "Rooftop"] },
  { keywords: ["便利店", "咖啡店", "咖啡", "窗边的位置"], values: ["Coffee Shop", "Cafe Window"] },
  { keywords: ["通勤", "subway", "地铁", "车窗"], values: ["Subway", "Road Window"] },
  { keywords: ["花店", "街角"], values: ["Flower Shop", "Late Walk"] },
  { keywords: ["书店", "展览", "白墙"], values: ["Bookstore", "Gallery"] },
  { keywords: ["早午餐", "brunch"], values: ["Weekend Brunch", "Coffee Shop"] },
  { keywords: ["彩虹", "晚霞", "落日", "夕阳"], values: ["Golden Hour", "Rainbow Glow"] },
  { keywords: ["草地", "晴光", "晒到发暖"], values: ["Sunny Grass"] },
  { keywords: ["游乐园", "夜场"], values: ["Fairground"] },
];

const CANONICAL_TIME_RULES: KeywordRule[] = [
  { keywords: ["清晨", "晨光", "早午餐", "刚醒来", "morning"], values: ["Morning"] },
  { keywords: ["晚霞", "下班", "傍晚", "evening"], values: ["Evening"] },
  { keywords: ["夜", "深夜", "夜市", "夜路", "夜跑", "night"], values: ["Night"] },
  { keywords: ["周末", "weekend"], values: ["Weekend"] },
];

const CANONICAL_WEATHER_RULES: KeywordRule[] = [
  { keywords: ["雨", "rain"], values: ["Rain"] },
  { keywords: ["阴", "云", "cloudy"], values: ["Cloudy"] },
  { keywords: ["彩虹", "晚霞", "晴", "天光", "好天气", "阳光", "草地"], values: ["Sunny"] },
  { keywords: ["晚风", "海风", "风"], values: ["Breezy"] },
];

function inferNeedTokens(plan: AotdPlan): string[] {
  const joined = buildRuleJoinedText(plan);
  const canonicalNeeds = inferCanonicalNeeds(plan);
  const expansions = canonicalNeeds.flatMap((need) => NEED_TOKEN_EXPANSIONS[need] || [need]);
  return [...new Set(expansions.concat(collectRuleValues(joined, CANONICAL_NEED_RULES)).map(normalizeToken).filter(Boolean))];
}

function inferPreferredEnergy(plan: AotdPlan): SongDocument["energy"] | undefined {
  const joined = buildRuleJoinedText(plan);
  const canonicalNeeds = inferCanonicalNeeds(plan);
  if (canonicalNeeds.includes("Celebrate")) return "high";
  if (canonicalNeeds.includes("Growth") || canonicalNeeds.includes("Explore")) return "medium";
  if (canonicalNeeds.includes("Recovery") || canonicalNeeds.includes("Companion") || canonicalNeeds.includes("Reflection")) {
    return "low";
  }
  if (joined.includes("focus") || joined.includes("groove") || joined.includes("推进") || joined.includes("夜跑")) return "medium";
  if (joined.includes("calm") || joined.includes("wind down") || joined.includes("soft") || joined.includes("healing")) {
    return "low";
  }
  if (joined.includes("confident") || joined.includes("celebrate") || joined.includes("上头")) return "high";
  return undefined;
}

function inferImageryTokens(plan: AotdPlan): string[] {
  const joined = `${plan.emotionalImagery} ${plan.userIntent} ${plan.todayStateSummary}`.toLowerCase();
  const tokens: string[] = [];

  if (joined.includes("雨夜") || joined.includes("窗边")) {
    tokens.push("rain", "night");
  }
  if (joined.includes("散步")) {
    tokens.push("walk");
  }
  if (joined.includes("城市") || joined.includes("霓虹")) {
    tokens.push("city");
  }
  if (joined.includes("海边") || joined.includes("晚风")) {
    tokens.push("beach");
  }
  if (joined.includes("房间") || joined.includes("独处")) {
    tokens.push("indoor");
  }
  if (joined.includes("花店")) {
    tokens.push("flower", "warm");
  }
  if (joined.includes("书店") || joined.includes("展览")) {
    tokens.push("bookstore", "gallery");
  }
  if (joined.includes("彩虹") || joined.includes("晚霞") || joined.includes("夕阳")) {
    tokens.push("sunset", "rainbow", "golden");
  }
  if (joined.includes("夜市") || joined.includes("彩灯") || joined.includes("游乐园")) {
    tokens.push("nightmarket", "fairground");
  }
  if (joined.includes("草地") || joined.includes("晴光")) {
    tokens.push("grass", "sunny");
  }
  if (joined.includes("咖啡店")) {
    tokens.push("coffee");
  }
  if (joined.includes("车窗") || joined.includes("公路")) {
    tokens.push("road", "window");
  }
  if (joined.includes("天台")) {
    tokens.push("rooftop");
  }

  return [...new Set(tokens)];
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildRotationSeed(input: number | string | undefined): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.abs(Math.floor(input)) || 1;
  }
  if (typeof input === "string" && input) {
    return hashString(input) || 1;
  }
  return hashString(`${Date.now()}-${Math.random()}`) || 1;
}

// 加权采样 + 截断 + 同艺人互斥：是 retriever 的核心；shuffleBySeed / pickTieredCandidates 已被替换为这条路径

function inferCanonicalNeeds(plan: AotdPlan): string[] {
  return collectRuleValues(buildRuleJoinedText(plan), CANONICAL_NEED_RULES);
}

function inferCanonicalScenes(plan: AotdPlan): string[] {
  return collectRuleValues(buildRuleJoinedText(plan), CANONICAL_SCENE_RULES);
}

function inferCanonicalTimes(plan: AotdPlan): string[] {
  const joined = buildRuleJoinedText(plan);
  const times = collectRuleValues(joined, CANONICAL_TIME_RULES);
  if (times.includes("Night") && !times.includes("Evening")) {
    times.push("Evening");
  }
  return [...new Set(times)];
}

function inferCanonicalWeather(plan: AotdPlan): string[] {
  return collectRuleValues(buildRuleJoinedText(plan), CANONICAL_WEATHER_RULES);
}

function isRejected(song: SongDocument): boolean {
  return song.reviewStatus.toLowerCase() === "rejected";
}

function isResolvedPlayable(song: SongDocument): boolean {
  return song.isPlayable || Boolean(song.originalId && song.encryptedId) || song.idStatus.toLowerCase() === "done";
}

function pickDiverseCandidates(
  candidates: RetrievalCandidate[],
  limit: number,
  options: { seed?: number } = {},
): RetrievalCandidate[] {
  if (limit <= 0 || candidates.length === 0) return [];

  const seed = options.seed ?? 0;
  const useRealRandom = !seed;

  // 权重：score + 30 作为基线（clamp 到 1+）
  // 关键：单一高分歌（gravity 这种"啥都匹配"的）不能一统天下，按"中位数 × 5"做硬截断
  const rawWeights = candidates.map((candidate) => Math.max(1, candidate.score + 30));
  const sortedWeights = [...rawWeights].sort((left, right) => left - right);
  const medianWeight = sortedWeights[Math.floor(sortedWeights.length / 2)] || 1;
  const maxAllowed = Math.max(medianWeight * 5, 5);
  const weights = rawWeights.map((weight) => Math.min(weight, maxAllowed));

  // 加权采样（无放回），并强制"同艺人互斥"
  const selected: RetrievalCandidate[] = [];
  const usedArtists = new Set<string>();
  const remainingItems: RetrievalCandidate[] = [...candidates];
  const remainingWeights: number[] = [...weights];

  for (let pickIdx = 0; pickIdx < limit && remainingItems.length > 0; pickIdx += 1) {
    // 同艺人权重清零
    for (let j = 0; j < remainingItems.length; j += 1) {
      if (usedArtists.has(remainingItems[j].song.artist)) {
        remainingWeights[j] = 0;
      }
    }

    const total = remainingWeights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) break;

    const randomValue = useRealRandom
      ? Math.random()
      : (hashString(`${seed}::${pickIdx}::${remainingItems.length}`) % 100000) / 100000;
    const target = randomValue * total;

    let cumsum = 0;
    let selectedIdx = remainingItems.length - 1;
    for (let j = 0; j < remainingItems.length; j += 1) {
      cumsum += remainingWeights[j];
      if (cumsum >= target) {
        selectedIdx = j;
        break;
      }
    }

    const picked = remainingItems[selectedIdx];
    selected.push(picked);
    usedArtists.add(picked.song.artist);
    remainingItems.splice(selectedIdx, 1);
    remainingWeights.splice(selectedIdx, 1);
  }

  return selected
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((candidate, index) => ({
      ...candidate,
      score: Number((candidate.score - index * 0.1).toFixed(3)),
    }));
}

function similarity(left: RetrievalCandidate, right: RetrievalCandidate): number {
  let score = 0;
  if (left.song.artist.toLowerCase() === right.song.artist.toLowerCase()) score += 1.2;
  if (left.song.genre && left.song.genre.toLowerCase() === right.song.genre.toLowerCase()) score += 0.45;
  if (left.song.language && left.song.language.toLowerCase() === right.song.language.toLowerCase()) score += 0.35;
  if (left.song.primaryNeed && left.song.primaryNeed.toLowerCase() === right.song.primaryNeed.toLowerCase()) score += 0.5;
  if (left.song.energy === right.song.energy) score += 0.25;

  const leftScenes = new Set(left.song.sceneTags.map((item) => item.toLowerCase()));
  const rightScenes = right.song.sceneTags.map((item) => item.toLowerCase());
  if (rightScenes.some((item) => leftScenes.has(item))) score += 0.55;

  return score;
}

function scoreSong(plan: AotdPlan, song: SongDocument): RetrievalCandidate {
  const scoreBreakdown: string[] = [];
  const matchedSignals = new Set<string>();
  let score = 0;
  const canonicalNeeds = inferCanonicalNeeds(plan);
  const canonicalScenes = inferCanonicalScenes(plan);
  const canonicalTimes = inferCanonicalTimes(plan);
  const canonicalWeather = inferCanonicalWeather(plan);

  if (canonicalNeeds.length > 0) {
    const needIndex = canonicalNeeds.findIndex((item) => item.toLowerCase() === song.primaryNeed.toLowerCase());
    if (needIndex === 0) {
      score += 26;
      scoreBreakdown.push("need-primary +26");
      matchedSignals.add(song.primaryNeed);
    } else if (needIndex > 0) {
      score += 18;
      scoreBreakdown.push("need-secondary +18");
      matchedSignals.add(song.primaryNeed);
    } else {
      score -= 8;
      scoreBreakdown.push("need-mismatch -8");
    }
  }

  if (canonicalScenes.length > 0) {
    const sceneIndex = canonicalScenes.findIndex((item) =>
      song.sceneTags.some((tag) => tag.toLowerCase() === item.toLowerCase()),
    );
    if (sceneIndex === 0) {
      score += 24;
      scoreBreakdown.push("scene-primary +24");
    } else if (sceneIndex > 0) {
      score += 14;
      scoreBreakdown.push("scene-secondary +14");
    } else {
      score -= 6;
      scoreBreakdown.push("scene-mismatch -6");
    }
  }

  if (canonicalTimes.length > 0) {
    const timeMatches = canonicalTimes.filter((item) => song.timeTags.some((tag) => tag.toLowerCase() === item.toLowerCase()));
    if (timeMatches.length > 0) {
      score += timeMatches.length * 6;
      scoreBreakdown.push(`time-direct +${timeMatches.length * 6}`);
    }
  }

  if (canonicalWeather.length > 0) {
    const weatherMatches = canonicalWeather.filter((item) =>
      song.weatherTags.some((tag) => tag.toLowerCase() === item.toLowerCase()),
    );
    if (weatherMatches.length > 0) {
      score += weatherMatches.length * 6;
      scoreBreakdown.push(`weather-direct +${weatherMatches.length * 6}`);
    }
  }

  const needMatches = containsAny(inferNeedTokens(plan), song.needTags);
  if (needMatches.length > 0) {
    score += needMatches.length * 18;
    needMatches.forEach((item) => matchedSignals.add(item));
    scoreBreakdown.push(`need +${needMatches.length * 18}`);
  }

  const sceneMatches = containsAny([...plan.sceneSignals, ...inferCanonicalScenes(plan)], song.sceneTags);
  if (sceneMatches.length > 0) {
    score += sceneMatches.length * 12;
    sceneMatches.forEach((item) => matchedSignals.add(item));
    scoreBreakdown.push(`scene +${sceneMatches.length * 12}`);
  }

  const weatherMatches = containsAny([...plan.queryHints, ...inferCanonicalWeather(plan)], song.weatherTags);
  if (weatherMatches.length > 0) {
    score += weatherMatches.length * 10;
    weatherMatches.forEach((item) => matchedSignals.add(item));
    scoreBreakdown.push(`weather +${weatherMatches.length * 10}`);
  }

  const timeMatches = containsAny([...plan.sceneSignals, ...plan.queryHints, ...inferCanonicalTimes(plan)], song.timeTags);
  if (timeMatches.length > 0) {
    score += timeMatches.length * 10;
    timeMatches.forEach((item) => matchedSignals.add(item));
    scoreBreakdown.push(`time +${timeMatches.length * 10}`);
  }

  const tagMatches = containsAny(
    [plan.consumptionSource, plan.emotionalNeed, plan.emotionalImagery, ...plan.queryHints, ...plan.objectiveSignals],
    song.tags,
  );
  if (tagMatches.length > 0) {
    score += tagMatches.length * 6;
    tagMatches.forEach((item) => matchedSignals.add(item));
    scoreBreakdown.push(`tag +${tagMatches.length * 6}`);
  }

  const imageryMatches = containsAny(inferImageryTokens(plan), song.tags);
  if (imageryMatches.length > 0) {
    score += imageryMatches.length * 8;
    imageryMatches.forEach((item) => matchedSignals.add(item));
    scoreBreakdown.push(`imagery +${imageryMatches.length * 8}`);
  }

  const preferredEnergy = inferPreferredEnergy(plan);
  if (preferredEnergy && preferredEnergy === song.energy) {
    score += 8;
    scoreBreakdown.push("energy +8");
  }

  if (song.priority !== undefined) {
    const priorityBoost = Math.max(0, Math.min(song.priority, 1)) * 6;
    if (priorityBoost > 0) {
      score += priorityBoost;
      scoreBreakdown.push(`priority +${priorityBoost.toFixed(1)}`);
    }
  }

  if (isResolvedPlayable(song)) {
    score += 12;
    scoreBreakdown.push("playable +12");
  }

  if (
    plan.constraints.some(
      (item) => item.includes("不要太炸") || item.includes("不要过于喧闹") || item.includes("不要太吵"),
    ) &&
    song.energy === "high"
  ) {
    score -= 24;
    scoreBreakdown.push("constraint -24");
  }

  if (plan.constraints.some((item) => item.includes("不要太丧")) && song.moods.some((item) => item.includes("低落"))) {
    score -= 10;
    scoreBreakdown.push("constraint -10");
  }

  if (
    plan.constraints.some((item) => item.includes("不要太苦") || item.includes("避免过度悲伤")) &&
    song.tags.some((item) => {
      const tag = item.toLowerCase();
      return tag.includes("rain") || tag.includes("night");
    }) &&
    song.energy === "high"
  ) {
    score -= 12;
    scoreBreakdown.push("constraint -12");
  }

  if (plan.sceneSignals.some((item) => item.includes("夜晚")) && song.scenes.some((item) => item.includes("夜晚"))) {
    score += 6;
    scoreBreakdown.push("night +6");
  }

  if (plan.sceneSignals.some((item) => item.includes("散步")) && song.tags.some((item) => item.includes("walk"))) {
    score += 6;
    scoreBreakdown.push("walk +6");
  }

  if (plan.objectiveSignals.some((item) => item.includes("专注")) && song.tags.some((item) => item.includes("focus"))) {
    score += 8;
    scoreBreakdown.push("focus +8");
  }

  if (plan.queryHints.some((item) => item.toLowerCase().includes("night")) && song.tags.some((item) => item.toLowerCase().includes("night"))) {
    score += 6;
    scoreBreakdown.push("hint-night +6");
  }

  if (plan.queryHints.some((item) => item.toLowerCase().includes("rain")) && song.tags.some((item) => item.toLowerCase().includes("rain"))) {
    score += 6;
    scoreBreakdown.push("hint-rain +6");
  }

  if (plan.queryHints.some((item) => item.toLowerCase().includes("healing")) && song.tags.some((item) => item.toLowerCase().includes("recovery"))) {
    score += 8;
    scoreBreakdown.push("hint-healing +8");
  }

  if (plan.queryHints.some((item) => item.toLowerCase().includes("companion")) && song.tags.some((item) => item.toLowerCase().includes("companion"))) {
    score += 8;
    scoreBreakdown.push("hint-companion +8");
  }

  const planKey = [plan.consumptionSource, plan.emotionalNeed, plan.emotionalImagery].join("|");
  const deterministicJitter = ((hashString(`${planKey}|${song.id}`) % 400) / 100) - 2;
  score += deterministicJitter;
  scoreBreakdown.push(`jitter ${deterministicJitter >= 0 ? "+" : ""}${deterministicJitter.toFixed(2)}`);

  return {
    song,
    score,
    matchedSignals: [...matchedSignals],
    reason:
      matchedSignals.size > 0
        ? `命中信号：${[...matchedSignals].slice(0, 4).join("、")}`
        : "当前主要作为兜底候选，靠字段接近度与能量级别匹配。",
    scoreBreakdown,
  };
}

export class AotdRetriever {
  constructor(private readonly catalog: SongDocument[]) {}

  retrieve(
    plan: AotdPlan,
    limit = 5,
    options?: { excludeSongIds?: string[]; excludeSongKeys?: string[]; rotationSeed?: number | string },
  ): RetrievalCandidate[] {
    const excludedIds = new Set((options?.excludeSongIds || []).map((item) => item.toLowerCase()));
    const excludedKeys = new Set((options?.excludeSongKeys || []).map((item) => item.toLowerCase()));
    const eligibleCatalog = this.catalog.filter((song) => {
      if (isRejected(song) || excludedIds.has(song.id.toLowerCase())) {
        return false;
      }

      const songKey = `${song.title}::${song.artist}`.toLowerCase();
      return !excludedKeys.has(songKey);
    });
    const fallbackCatalog = this.catalog.filter((song) => !isRejected(song));
    const rankingSource = eligibleCatalog.length > 0 ? eligibleCatalog : fallbackCatalog;

    const seed = buildRotationSeed(options?.rotationSeed);

    const deduped = new Map<string, RetrievalCandidate>();

    for (const candidate of rankingSource
      .map((song) => scoreSong(plan, song))
      .sort((left, right) => right.score - left.score)) {
      const key = `${candidate.song.title}::${candidate.song.artist}`.toLowerCase();
      const existing = deduped.get(key);
      if (!existing || candidate.score > existing.score) {
        deduped.set(key, candidate);
      }
    }

    // 关键：直接在全量候选（去重后 600+ 首）上做加权采样 + 中位数截断 + 同艺人互斥
    // 不再做 topK 截断——gravity 这种"啥都匹配"的歌一旦进 topK 必中。
    // 把"是否进入推荐"完全交给加权随机，权重由 score 决定，但硬截断防止一首歌独大。
    const allRanked = [...deduped.values()];
    return pickDiverseCandidates(allRanked, limit, { seed });
  }
}
