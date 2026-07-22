// 验证"开心明朗 vs emo低气压"在 20 轮下结果明显不同
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

// 开心明朗：被看见认可 + 把开心放大 + 彩虹天光
const happyPlan = {
  consumptionSource: "被看见认可",
  emotionalNeed: "把开心放大",
  emotionalImagery: "彩虹天光",
  userIntent: "想把那一下被认真看见的感觉继续留住。",
  todayStateSummary: "今天被生活轻轻奖励了一下，想把这点亮度继续留久一点。",
  moodSignals: ["被看见", "自我确认", "开心", "被生活安慰", "轻盈"],
  sceneSignals: ["彩虹", "天光", "晴朗", "轻盈"],
  objectiveSignals: ["把开心放大", "延长好状态", "保留轻盈"],
  constraints: ["避免太苦", "避免土味煽情"],
  playlistStrategy: "选轻量级、明亮、有探索感的歌。",
  queryHints: ["rainbow glow", "bright", "celebrate", "sunny", "light", "discovery"],
  explanationStyle: "像心理咨询师，先识别状态再给歌。",
  uncertainty: [],
};

// emo低气压：情绪压力 + 有人陪伴 + 深夜便利店
const emoPlan = {
  consumptionSource: "情绪压力",
  emotionalNeed: "有人陪伴",
  emotionalImagery: "深夜便利店",
  userIntent: "想被接住、不想一个人。",
  todayStateSummary: "表面还行，里面一直在消耗。",
  moodSignals: ["闷着", "内在消耗", "需要被接住", "敏感"],
  sceneSignals: ["深夜", "便利店", "冷白灯", "独处", "安静"],
  objectiveSignals: ["降低悬空感", "增加被包裹感"],
  constraints: ["不要太苦", "避免过度失恋叙事"],
  playlistStrategy: "选温柔、陪伴感、低能量的歌。",
  queryHints: ["companion", "soft comfort", "warm", "night", "convenience store"],
  explanationStyle: "像心理咨询师，先识别状态再给歌。",
  uncertainty: [],
};

const catalog = loadSongsFromWorkbook(workbookPath);
const retriever = new AotdRetriever(catalog);

function runPlan(plan, label) {
  const firsts = []; // 每轮的第一首歌
  const collected = [];
  const excludeSongIds = [];
  const excludeSongKeys = [];

  for (let round = 1; round <= 20; round += 1) {
    const candidates = retriever.retrieve(plan, 5, {
      excludeSongIds,
      excludeSongKeys,
      rotationSeed: `${label}-${round}-${Date.now()}-${Math.random()}`,
    });
    const picked = candidates.slice(0, 5);
    firsts.push(`${picked[0].song.title}(${picked[0].song.artist})`);
    picked.forEach((c) => {
      collected.push({ round, title: c.song.title, artist: c.song.artist, score: c.score });
      excludeSongIds.push(c.song.id);
      excludeSongKeys.push(`${c.song.title}::${c.song.artist}`.toLowerCase());
    });
  }

  console.log(`\n===== ${label} · 20 轮 =====`);
  firsts.forEach((s, i) => console.log(`  round ${i + 1} 第一首: ${s}`));
  const firstCounts = {};
  firsts.forEach((f) => {
    const key = f.split("(")[0].trim();
    firstCounts[key] = (firstCounts[key] || 0) + 1;
  });
  const top = Object.entries(firstCounts).sort(([, a], [, b]) => b - a).slice(0, 5);
  console.log(`  第一首歌 Top 5: ${JSON.stringify(top)}`);
  const unique = new Set(collected.map((c) => `${c.title}::${c.artist}`));
  console.log(`  20 轮共 100 首推荐，去重后 ${unique.size} 首 (${((unique.size / 100) * 100).toFixed(1)}%)`);
  return { firsts, collected };
}

const happy = runPlan(happyPlan, "开心明朗");
const emo = runPlan(emoPlan, "emo低气压");

const happySet = new Set(happy.collected.map((c) => `${c.title}::${c.artist}`));
const emoSet = new Set(emo.collected.map((c) => `${c.title}::${c.artist}`));
let overlap = 0;
happySet.forEach((s) => { if (emoSet.has(s)) overlap += 1; });
console.log(`\n===== 两组重合度 =====`);
console.log(`开心明朗 100 首 vs emo低气压 100 首，重合 ${overlap} 首 (${((overlap / 100) * 100).toFixed(1)}%)`);

const gravity = "Gravity::John Mayer";
const happyGravityCount = happy.collected.filter((c) => `${c.title}::${c.artist}` === gravity).length;
const emoGravityCount = emo.collected.filter((c) => `${c.title}::${c.artist}` === gravity).length;
console.log(`Gravity(John Mayer) 出现次数：开心明朗 ${happyGravityCount}/100，emo低气压 ${emoGravityCount}/100`);

const happyFirstsGravity = happy.firsts.filter((f) => f.startsWith("Gravity")).length;
const emoFirstsGravity = emo.firsts.filter((f) => f.startsWith("Gravity")).length;
console.log(`Gravity 当第一首的次数：开心明朗 ${happyFirstsGravity}/20，emo低气压 ${emoFirstsGravity}/20`);
