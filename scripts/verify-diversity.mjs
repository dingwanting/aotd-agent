// 验证脚本：用同一组 answers 连跑 8 轮 retriever，确认 40 首歌不集中在同一批
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AotdRetriever } from "../src/domain/aotd/retriever.js";
import { loadSongsFromWorkbook } from "../src/domain/aotd/workbook-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const workbookPath = path.resolve(
  projectRoot,
  "data/AOTD_500_Song_Library_Enhanced.xlsx"
);

// 模拟 planner 生成的 plan：用户选了"被看见认可" + "把开心放大" + "彩虹天光"
const plan = {
  consumptionSource: "被看见认可",
  emotionalNeed: "把开心放大",
  emotionalImagery: "彩虹天光",
  userIntent: "想把那一下被认真看见的感觉继续留住。",
  todayStateSummary: "今天不是低落，而是被生活轻轻奖励了一下，想把这点亮度继续留久一点。",
  moodSignals: ["被看见", "自我确认", "开心", "被生活安慰", "轻盈"],
  sceneSignals: ["彩虹", "天光", "晴朗", "轻盈"],
  objectiveSignals: ["把开心放大", "延长好状态", "保留轻盈"],
  constraints: ["避免太苦", "避免土味煽情"],
  playlistStrategy: "先识别状态，再选轻量级、明亮、有探索感的歌。",
  queryHints: ["rainbow glow", "bright", "celebrate", "sunny", "light", "discovery"],
  explanationStyle: "像心理咨询师，先识别状态再给歌。",
  uncertainty: [],
};

const catalog = loadSongsFromWorkbook(workbookPath);
console.log(`catalog loaded: ${catalog.length} songs`);

const retriever = new AotdRetriever(catalog);

const collected = [];
const excludeSongIds = [];
const excludeSongKeys = [];

for (let round = 1; round <= 8; round += 1) {
  const seed = `round-${round}-${Date.now()}-${Math.random()}`;
  const candidates = retriever.retrieve(plan, 12, {
    excludeSongIds,
    excludeSongKeys,
    rotationSeed: seed,
  });

  const picked = candidates.slice(0, 5);
  picked.forEach((candidate) => {
    collected.push({
      round,
      title: candidate.song.title,
      artist: candidate.song.artist,
      need: candidate.song.primaryNeed,
      energy: candidate.song.energy,
      score: candidate.score.toFixed(2),
    });
    excludeSongIds.push(candidate.song.id);
    excludeSongKeys.push(`${candidate.song.title}::${candidate.song.artist}`.toLowerCase());
  });

  console.log(
    `round ${round}: ${picked.map((c) => `${c.song.title}(${c.song.artist})`).join(" | ")}`
  );
}

const totalSongs = collected.length;
const uniqueSongKeys = new Set(collected.map((c) => `${c.title}::${c.artist}`));
const uniqueRatio = (uniqueSongKeys.size / totalSongs) * 100;
const uniqueArtistCount = new Set(collected.map((c) => c.artist)).size;

console.log("");
console.log("===== 验证结果 =====");
console.log(`8 轮共 ${totalSongs} 首推荐，去重后 ${uniqueSongKeys.size} 首 (${uniqueRatio.toFixed(1)}%)`);
console.log(`涉及 ${uniqueArtistCount} 位独立艺人`);

const artistCounter = {};
collected.forEach((c) => {
  artistCounter[c.artist] = (artistCounter[c.artist] || 0) + 1;
});
const topArtists = Object.entries(artistCounter)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 5);
console.log("Top 5 出现频次最高的艺人:", topArtists);

const songCounter = {};
collected.forEach((c) => {
  const key = `${c.title}::${c.artist}`;
  songCounter[key] = (songCounter[key] || 0) + 1;
});
const duplicateSongs = Object.entries(songCounter).filter(([, count]) => count > 1);
console.log(`重复出现的歌: ${duplicateSongs.length} 首`);
duplicateSongs.forEach(([key, count]) => {
  console.log(`  - ${key} (出现 ${count} 次)`);
});
