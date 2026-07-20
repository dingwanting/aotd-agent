import type { AotdPlan, RetrievalCandidate, SongDocument } from "./types.js";

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

function inferNeedTokens(plan: AotdPlan): string[] {
  const joined = [
    plan.emotionalNeed,
    plan.consumptionSource,
    ...plan.objectiveSignals,
    ...plan.queryHints,
    ...plan.moodSignals,
  ]
    .join(" ")
    .toLowerCase();
  const needs: string[] = [];

  if (joined.includes("healing") || joined.includes("recovery") || joined.includes("放松") || joined.includes("排水")) {
    needs.push("recovery");
  }
  if (joined.includes("companion") || joined.includes("陪伴")) {
    needs.push("companion");
  }
  if (joined.includes("reflect") || joined.includes("reflection") || joined.includes("向内") || joined.includes("整理")) {
    needs.push("reflection");
  }
  if (joined.includes("escape") || joined.includes("逃离")) {
    needs.push("escape");
  }
  if (joined.includes("growth") || joined.includes("启动") || joined.includes("进入状态")) {
    needs.push("growth");
  }
  if (joined.includes("celebrate") || joined.includes("开心") || joined.includes("庆祝")) {
    needs.push("celebrate");
  }

  return needs;
}

function inferPreferredEnergy(plan: AotdPlan): SongDocument["energy"] | undefined {
  const joined = [plan.emotionalNeed, plan.emotionalImagery, ...plan.constraints, ...plan.objectiveSignals, ...plan.queryHints]
    .join(" ")
    .toLowerCase();
  if (joined.includes("focus") || joined.includes("groove") || joined.includes("推进")) {
    return "medium";
  }
  if (joined.includes("calm") || joined.includes("wind down") || joined.includes("soft") || joined.includes("healing")) {
    return "low";
  }
  if (joined.includes("confident") || joined.includes("celebrate")) {
    return "high";
  }
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

  return [...new Set(tokens)];
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function inferCanonicalNeeds(plan: AotdPlan): string[] {
  const joined = [
    plan.emotionalNeed,
    ...plan.objectiveSignals,
    ...plan.queryHints,
    ...plan.moodSignals,
    plan.userIntent,
  ]
    .join(" ")
    .toLowerCase();

  const needs: string[] = [];
  if (joined.includes("陪伴") || joined.includes("被接住") || joined.includes("companion")) {
    needs.push("Companion");
  }
  if (
    joined.includes("放松") ||
    joined.includes("排水") ||
    joined.includes("回暖") ||
    joined.includes("recovery") ||
    joined.includes("healing")
  ) {
    needs.push("Recovery");
  }
  if (
    joined.includes("清空") ||
    joined.includes("放空") ||
    joined.includes("抽离") ||
    joined.includes("整理") ||
    joined.includes("reflection")
  ) {
    needs.push("Reflection");
  }
  if (joined.includes("escape") || joined.includes("逃离") || joined.includes("透气")) {
    needs.push("Escape");
  }
  if (joined.includes("找回力量") || joined.includes("重新启动") || joined.includes("growth") || joined.includes("提振")) {
    needs.push("Growth");
  }
  if (joined.includes("奖励自己") || joined.includes("celebrate") || joined.includes("庆祝")) {
    needs.push("Celebrate");
  }

  return [...new Set(needs)];
}

function inferCanonicalScenes(plan: AotdPlan): string[] {
  const joined = [plan.emotionalImagery, ...plan.sceneSignals, plan.userIntent].join(" ").toLowerCase();
  const scenes: string[] = [];

  if (joined.includes("东京雨夜") || joined.includes("雨夜") || joined.includes("窗边")) {
    scenes.push("Tokyo Rain");
  }
  if (joined.includes("城市灯光") || joined.includes("城市霓虹") || joined.includes("都市街头") || joined.includes("city")) {
    scenes.push("City Night");
  }
  if (joined.includes("海边公路") || joined.includes("晚风海边") || joined.includes("海边")) {
    scenes.push("Beach Road");
  }
  if (joined.includes("夜晚散步") || joined.includes("散步") || joined.includes("late walk")) {
    scenes.push("Late Walk");
  }
  if (joined.includes("深夜便利店") || joined.includes("便利店") || joined.includes("房间独处") || joined.includes("独处")) {
    scenes.push("Coffee Shop");
  }
  if (joined.includes("通勤") || joined.includes("subway") || joined.includes("车窗")) {
    scenes.push("Subway");
  }

  return [...new Set(scenes)];
}

function inferCanonicalTimes(plan: AotdPlan): string[] {
  const joined = [plan.emotionalImagery, ...plan.sceneSignals, ...plan.queryHints].join(" ").toLowerCase();
  const times: string[] = [];
  if (joined.includes("night") || joined.includes("夜") || joined.includes("深夜")) {
    times.push("Night", "Evening");
  }
  if (joined.includes("清晨")) {
    times.push("Morning");
  }
  return [...new Set(times)];
}

function inferCanonicalWeather(plan: AotdPlan): string[] {
  const joined = [plan.emotionalImagery, ...plan.sceneSignals, ...plan.queryHints].join(" ").toLowerCase();
  const weather: string[] = [];
  if (joined.includes("rain") || joined.includes("雨")) {
    weather.push("Rain");
  }
  if (joined.includes("cloudy") || joined.includes("阴")) {
    weather.push("Cloudy");
  }
  return [...new Set(weather)];
}

function isRejected(song: SongDocument): boolean {
  return song.reviewStatus.toLowerCase() === "rejected";
}

function isResolvedPlayable(song: SongDocument): boolean {
  return song.isPlayable || Boolean(song.originalId && song.encryptedId) || song.idStatus.toLowerCase() === "done";
}

function pickDiverseCandidates(candidates: RetrievalCandidate[], limit: number): RetrievalCandidate[] {
  const pool = candidates.slice(0, Math.max(limit * 4, 24));
  const selected: RetrievalCandidate[] = [];
  const remaining = [...pool];

  function similarity(left: RetrievalCandidate, right: RetrievalCandidate): number {
    let score = 0;
    if (left.song.artist.toLowerCase() === right.song.artist.toLowerCase()) score += 1.2;
    if (left.song.genre && left.song.genre.toLowerCase() === right.song.genre.toLowerCase()) score += 0.45;
    if (left.song.primaryNeed && left.song.primaryNeed.toLowerCase() === right.song.primaryNeed.toLowerCase()) score += 0.5;
    if (left.song.energy === right.song.energy) score += 0.25;

    const leftScenes = new Set(left.song.sceneTags.map((item) => item.toLowerCase()));
    const rightScenes = right.song.sceneTags.map((item) => item.toLowerCase());
    if (rightScenes.some((item) => leftScenes.has(item))) score += 0.55;

    return score;
  }

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      const noveltyPenalty =
        selected.length === 0 ? 0 : Math.max(...selected.map((picked) => similarity(candidate, picked))) * 7.5;
      const adjustedScore = candidate.score - noveltyPenalty;
      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = index;
      }
    });

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  if (selected.length < limit) {
    for (const candidate of candidates) {
      if (selected.length >= limit) break;
      const exists = selected.some((item) => item.song.id === candidate.song.id);
      if (!exists) selected.push(candidate);
    }
  }

  return selected
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((candidate, index) => ({
      ...candidate,
      score: Number((candidate.score - index * 0.1).toFixed(3)),
    }));
}

function pickTieredCandidates(plan: AotdPlan, ranked: RetrievalCandidate[], limit: number): RetrievalCandidate[] {
  const primaryNeed = inferCanonicalNeeds(plan)[0];
  const primaryScene = inferCanonicalScenes(plan)[0];

  const primaryNeedPool: RetrievalCandidate[] = [];
  const sceneBoostPool: RetrievalCandidate[] = [];
  const support: RetrievalCandidate[] = [];

  for (const candidate of ranked) {
    const needMatch = primaryNeed
      ? candidate.song.primaryNeed.toLowerCase() === primaryNeed.toLowerCase()
      : false;
    const sceneMatch = primaryScene
      ? candidate.song.sceneTags.some((tag) => tag.toLowerCase() === primaryScene.toLowerCase())
      : false;

    if (needMatch) {
      primaryNeedPool.push(candidate);
    } else if (sceneMatch) {
      sceneBoostPool.push(candidate);
    } else {
      support.push(candidate);
    }
  }

  const selected: RetrievalCandidate[] = [];
  const appendUnique = (items: RetrievalCandidate[]) => {
    for (const item of items) {
      if (selected.length >= limit) break;
      if (!selected.some((picked) => picked.song.id === item.song.id)) {
        selected.push(item);
      }
    }
  };

  appendUnique(pickDiverseCandidates(primaryNeedPool, Math.min(6, primaryNeedPool.length, limit)));
  appendUnique(pickDiverseCandidates(sceneBoostPool, Math.min(1, sceneBoostPool.length, Math.max(limit - selected.length, 0))));
  appendUnique(pickDiverseCandidates(support, Math.max(limit - selected.length, 0)));

  return selected.slice(0, limit);
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

  const sceneMatches = containsAny(plan.sceneSignals, song.sceneTags);
  if (sceneMatches.length > 0) {
    score += sceneMatches.length * 12;
    sceneMatches.forEach((item) => matchedSignals.add(item));
    scoreBreakdown.push(`scene +${sceneMatches.length * 12}`);
  }

  const weatherMatches = containsAny(plan.queryHints, song.weatherTags);
  if (weatherMatches.length > 0) {
    score += weatherMatches.length * 10;
    weatherMatches.forEach((item) => matchedSignals.add(item));
    scoreBreakdown.push(`weather +${weatherMatches.length * 10}`);
  }

  const timeMatches = containsAny([...plan.sceneSignals, ...plan.queryHints], song.timeTags);
  if (timeMatches.length > 0) {
    score += timeMatches.length * 10;
    timeMatches.forEach((item) => matchedSignals.add(item));
    scoreBreakdown.push(`time +${timeMatches.length * 10}`);
  }

  const tagMatches = containsAny([...plan.queryHints, ...plan.objectiveSignals], song.tags);
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

  retrieve(plan: AotdPlan, limit = 5, options?: { excludeSongIds?: string[]; excludeSongKeys?: string[] }): RetrievalCandidate[] {
    const excludedIds = new Set((options?.excludeSongIds || []).map((item) => item.toLowerCase()));
    const excludedKeys = new Set((options?.excludeSongKeys || []).map((item) => item.toLowerCase()));
    const eligibleCatalog = this.catalog.filter((song) => {
      if (isRejected(song) || excludedIds.has(song.id.toLowerCase())) {
        return false;
      }

      const songKey = `${song.title}::${song.artist}`.toLowerCase();
      return !excludedKeys.has(songKey);
    });
    const playableCatalog = eligibleCatalog.filter((song) => isResolvedPlayable(song));
    const fallbackCatalog = this.catalog.filter((song) => !isRejected(song));
    const fallbackPlayableCatalog = fallbackCatalog.filter((song) => isResolvedPlayable(song));
    const rankingSource =
      playableCatalog.length > 0
        ? playableCatalog
        : eligibleCatalog.length > 0
          ? eligibleCatalog
          : fallbackPlayableCatalog.length > 0
            ? fallbackPlayableCatalog
            : fallbackCatalog;

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

    const ranked = [...deduped.values()].sort((left, right) => right.score - left.score);
    return pickTieredCandidates(plan, ranked, limit);
  }
}
