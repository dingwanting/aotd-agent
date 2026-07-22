// 第二组答案：工作拉扯 + 排水放松 + 雨夜窗边
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
  consumptionSource: "工作拉扯",
  emotionalNeed: "排水放松",
  emotionalImagery: "雨夜窗边",
  userIntent: "想从工作状态切回自己。",
  todayStateSummary: "今天被任务、责任和推进节奏拽得有点紧。",
  moodSignals: ["工作拉扯", "紧绷", "想被接住"],
  sceneSignals: ["雨夜", "窗边", "湿润空气"],
  objectiveSignals: ["从紧绷里退一步", "把工作状态切回自己"],
  constraints: ["不要太炸", "不要过度职场叙事"],
  playlistStrategy: "先识别状态，再选低能量、温暖、能承接雨夜氛围的歌。",
  queryHints: ["after work", "rainy night", "reset", "window", "soft"],
  explanationStyle: "像心理咨询师，先识别状态再给歌。",
  uncertainty: [],
};

const catalog = loadSongsFromWorkbook(workbookPath);
const retriever = new AotdRetriever(catalog);

const collected = [];
const excludeSongIds = [];
const excludeSongKeys = [];

for (let round = 1; round <= 8; round += 1) {
  const seed = `rainy-${round}-${Date.now()}-${Math.random()}`;
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
console.log("");
console.log("===== 验证结果（雨夜窗边组）=====");
console.log(`8 轮共 ${totalSongs} 首推荐，去重后 ${uniqueSongKeys.size} 首 (${((uniqueSongKeys.size / totalSongs) * 100).toFixed(1)}%)`);

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
