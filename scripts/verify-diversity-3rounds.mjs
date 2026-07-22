// 模拟真实使用：连续 3 轮（每轮只保留最近 2 轮历史），看 15 首歌是否唯一
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

const plan = {
  consumptionSource: "被看见认可",
  emotionalNeed: "把开心放大",
  emotionalImagery: "彩虹天光",
  userIntent: "想把那一下被认真看见的感觉继续留住。",
  todayStateSummary: "今天不是低落，而是被生活轻轻奖励了一下。",
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
const retriever = new AotdRetriever(catalog);

const collected = [];
let historyIds = [];
let historyKeys = [];

// 模拟每轮只保留最近 2 轮（前端 PLAYLIST_HISTORY_LIMIT = 6，但每轮只有 5 首）
const HISTORY_KEEP = 2;

console.log("===== 连续 3 轮刷新（每轮保留前 2 轮历史）=====\n");

for (let round = 1; round <= 3; round += 1) {
  const candidates = retriever.retrieve(plan, 5, {
    excludeSongIds: [...historyIds],
    excludeSongKeys: [...historyKeys],
    rotationSeed: `user-real-${round}-${Date.now()}-${Math.random()}`,
  });

  const picked = candidates.slice(0, 5);
  console.log(
    `round ${round}: ${picked.map((c) => `${c.song.title}(${c.song.artist})`).join(" | ")}`
  );
  picked.forEach((c) => {
    collected.push({ round, title: c.song.title, artist: c.song.artist, need: c.song.primaryNeed });
    historyIds.push(c.song.id);
    historyKeys.push(`${c.song.title}::${c.song.artist}`.toLowerCase());
  });

  // 模拟前端只保留最近 HISTORY_KEEP 轮
  if (round >= HISTORY_KEEP) {
    const dropRounds = collected.filter((c) => c.round <= round - HISTORY_KEEP);
    const dropKeys = new Set(dropRounds.map((c) => `${c.title}::${c.artist}`.toLowerCase()));
    historyIds = historyIds.filter((id, idx) => {
      const last = collected.filter((c) => c.round > round - HISTORY_KEEP)[idx - dropRounds.length];
      return !dropKeys.has(id);
    });
    historyKeys = historyKeys.filter((k) => !dropKeys.has(k));
  }
}

const uniqueSongKeys = new Set(collected.map((c) => `${c.title}::${c.artist}`));
const uniqueArtistCount = new Set(collected.map((c) => c.artist)).size;
const uniqueNeedCount = new Set(collected.map((c) => c.need)).size;

console.log(`\n3 轮共 ${collected.length} 首推荐`);
console.log(`去重后 ${uniqueSongKeys.size} 首 (${((uniqueSongKeys.size / collected.length) * 100).toFixed(1)}%)`);
console.log(`独立艺人 ${uniqueArtistCount} 位`);
console.log(`独立 primaryNeed ${uniqueNeedCount} 个`);

const songCounter = {};
collected.forEach((c) => {
  const key = `${c.title}::${c.artist}`;
  songCounter[key] = (songCounter[key] || 0) + 1;
});
const dupes = Object.entries(songCounter).filter(([, count]) => count > 1);
if (dupes.length === 0) {
  console.log("✅ 0 首重复，3 轮 15 首全部唯一");
} else {
  console.log(`❌ ${dupes.length} 首重复：`);
  dupes.forEach(([key, count]) => console.log(`  - ${key} (${count} 次)`));
}
