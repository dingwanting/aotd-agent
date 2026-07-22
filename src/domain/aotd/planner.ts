import { z } from "zod";

import type { AotdPlan, AotdRequest } from "./types.js";
import { renderQuestionnaireAnswers } from "./questionnaire.js";
import { aotdFewShotExamples } from "./few-shot-examples.js";
import { buildFewShotMessages } from "../../prompts/few-shot.js";
import { buildAotdSystemPrompt } from "../../prompts/system.js";
import { ClaudeStyleAgentRuntime } from "../../core/runtime.js";
import type { LLMClient } from "../../core/types.js";

const AotdPlanSchema = z.object({
  consumptionSource: z.string(),
  emotionalNeed: z.string(),
  emotionalImagery: z.string(),
  userIntent: z.string(),
  todayStateSummary: z.string(),
  moodSignals: z.array(z.string()),
  sceneSignals: z.array(z.string()),
  objectiveSignals: z.array(z.string()),
  constraints: z.array(z.string()),
  playlistStrategy: z.string(),
  queryHints: z.array(z.string()),
  explanationStyle: z.string(),
  uncertainty: z.array(z.string()),
});

interface SignalProfile {
  state: string;
  moodSignals: string[];
  objectiveSignals: string[];
  constraints: string[];
  queryHints: string[];
  intent?: string;
}

interface ImageryProfile {
  sceneSignals: string[];
  queryHints: string[];
  sceneSummary: string;
}

const SOURCE_PROFILES: Record<string, SignalProfile> = {
  工作拉扯: {
    state: "今天被任务、责任和推进节奏拽得有点紧",
    moodSignals: ["工作拉扯", "紧绷", "需要回收注意力"],
    objectiveSignals: ["从紧绷里退一步", "把工作状态切回自己"],
    constraints: ["不要太炸", "不要过度职场叙事"],
    queryHints: ["after work", "reset", "steady"],
  },
  信息过载: {
    state: "今天脑内弹窗有点多，真正消耗你的是信息密度",
    moodSignals: ["信息过载", "被打散", "脑噪偏高"],
    objectiveSignals: ["降低信息负担", "把注意力收回来"],
    constraints: ["不要歌词过密", "不要太吵"],
    queryHints: ["focus", "clear mind", "steady groove"],
  },
  关系内耗: {
    state: "你不是单纯累，而是被关系里的来回拉扯消耗了一层",
    moodSignals: ["关系拉扯", "敏感", "想被接住"],
    objectiveSignals: ["降低内耗", "保留柔软但不过度下坠"],
    constraints: ["不要失恋模板化", "不要太苦"],
    queryHints: ["companion", "soft comfort", "gentle"],
  },
  外部反馈: {
    state: "刚被生活轻轻奖励了一下",
    moodSignals: ["外部反馈", "被鼓励", "心情轻微上扬"],
    objectiveSignals: ["把这点亮度留久一点", "别太快降速"],
    constraints: ["避免过度苦情", "保留轻盈感"],
    queryHints: ["reward", "bright", "light uplift"],
    intent: "把这点被生活奖励的感觉再延长一点。",
  },
  被看见认可: {
    state: "需要把被看见的那一下继续留在身上",
    moodSignals: ["被看见", "自我确认", "轻微兴奋"],
    objectiveSignals: ["延长高光时刻", "保留被认可后的自信"],
    constraints: ["避免土味煽情", "不要太扁平"],
    queryHints: ["recognition", "confident", "glow"],
    intent: "想把那一下被认真看见的感觉继续留住。",
  },
  成就推进: {
    state: "今天有推进感，也想稳稳守住这份手感",
    moodSignals: ["推进感", "成就感", "稳定发力"],
    objectiveSignals: ["延续推进感", "把成就感变成后续动力"],
    constraints: ["不要太飘", "保留稳感"],
    queryHints: ["momentum", "growth", "steady uplift"],
    intent: "想把“今天没白过”的手感再延长一点。",
  },
  偶遇小确幸: {
    state: "像被一个小小惊喜碰亮了一下",
    moodSignals: ["小惊喜", "轻盈", "被生活安慰"],
    objectiveSignals: ["保留这点明亮", "放大生活感"],
    constraints: ["避免太重", "保留空气感"],
    queryHints: ["small joy", "sunny", "gentle bright"],
    intent: "想让这点不经意的开心别那么快散掉。",
  },
  关系连接: {
    state: "不是空着的，而是想把连接感接稳",
    moodSignals: ["被想到", "关系连接", "想分享"],
    objectiveSignals: ["延长连接感", "让今天更完整"],
    constraints: ["避免过度孤独叙事", "不要太苦"],
    queryHints: ["connection", "companion", "warm"],
    intent: "想把今天被想到、被连接到的感觉继续接稳。",
  },
  忙碌充实: {
    state: "今天是满的，但不是被掏空，而是需要一个漂亮收尾",
    moodSignals: ["忙碌充实", "高完成度", "节奏饱满"],
    objectiveSignals: ["把忙碌感过渡成满足感", "别让节奏突然坠下来"],
    constraints: ["避免太丧", "保留明亮感"],
    queryHints: ["productive", "satisfying", "steady"],
  },
  兴奋上头: {
    state: "不是低落，而是有点热、有点亮、还不想收场",
    moodSignals: ["兴奋", "状态上扬", "不想降速"],
    objectiveSignals: ["延续高点", "控制住不过载"],
    constraints: ["避免过度吵闹", "不要太炸裂"],
    queryHints: ["celebrate", "upbeat", "spark"],
  },
  好奇探索: {
    state: "今天的注意力被新鲜感牵着走",
    moodSignals: ["好奇", "探索欲", "轻微兴奋"],
    objectiveSignals: ["满足新鲜感", "让心继续往外打开"],
    constraints: ["避免太保守", "保留发现感"],
    queryHints: ["explore", "fresh", "curious"],
  },
  信息惊喜: {
    state: "今天更像被一个新发现勾住了注意力",
    moodSignals: ["新鲜感", "注意力被点亮", "想继续点开"],
    objectiveSignals: ["顺着兴趣往前走", "保留新鲜感"],
    constraints: ["避免太沉", "不要太封闭"],
    queryHints: ["discovery", "fresh", "city explore"],
  },
  沟通交流: {
    state: "今天被人和信息拉着走，心神有一点散",
    moodSignals: ["信息密度高", "被打断", "轻微疲惫"],
    objectiveSignals: ["把注意力收回来", "给心留一点安静"],
    constraints: ["避免过度喧闹", "不要歌词过密"],
    queryHints: ["focus", "reset", "soft groove"],
  },
  思考决策: {
    state: "脑内线程很多，真正缺的是一个落点",
    moodSignals: ["脑内运转", "判断消耗", "需要整理"],
    objectiveSignals: ["降低脑噪", "让判断压力慢一点"],
    constraints: ["避免再加信息负担", "不要太刺激"],
    queryHints: ["reflection", "clear mind", "steady"],
  },
  情绪压力: {
    state: "表面还行，但里面一直在消耗",
    moodSignals: ["闷着", "内在消耗", "需要被接住"],
    objectiveSignals: ["先卸力", "把紧绷慢慢放下来"],
    constraints: ["不要太苦", "不要再放大压力"],
    queryHints: ["recovery", "soft comfort", "gentle"],
  },
  重复工作: {
    state: "今天像在同一页里翻了很多次，身体在动，心没有完全跟上",
    moodSignals: ["重复", "轻微麻木", "想换气"],
    objectiveSignals: ["打破循环感", "给今天一个新鲜出口"],
    constraints: ["避免太平", "别太机械"],
    queryHints: ["refresh", "groove", "gentle lift"],
  },
  身体疲惫: {
    state: "不是想太多，是身体真的先说累了",
    moodSignals: ["身体疲惫", "能量见底", "需要恢复"],
    objectiveSignals: ["先缓下来", "慢慢回电"],
    constraints: ["不要太炸", "不要太吵"],
    queryHints: ["recovery", "wind down", "soft"],
  },
  日常仪式: {
    state: "今天其实在给自己偷偷留一点温柔余地",
    moodSignals: ["自我照顾", "微小仪式感", "情绪回暖"],
    objectiveSignals: ["放大小小的生活感", "让晚上更有收尾感"],
    constraints: ["避免太硬", "保留柔软感"],
    queryHints: ["ritual", "gentle", "warm"],
  },
  空心麻木: {
    state: "今天更像是轻微失速和发空，不太想被世界再推进",
    moodSignals: ["空心", "轻微麻木", "需要重新接回感受"],
    objectiveSignals: ["找回感受力", "让状态重新流动"],
    constraints: ["不要鸡血式鼓励", "避免太重"],
    queryHints: ["recovery", "reconnect", "soft"],
  },
  轻微焦虑: {
    state: "不是很严重的低落，而是心里一直悬着一点点",
    moodSignals: ["轻微焦虑", "悬着", "需要稳定"],
    objectiveSignals: ["把心放稳", "把节奏拉回可控范围"],
    constraints: ["不要再加刺激", "避免情绪过猛"],
    queryHints: ["steady", "calm", "gentle reset"],
  },
};

const NEED_PROFILES: Record<string, SignalProfile> = {
  被接住: {
    state: "你真正想要的，是一种稳稳被接住的感觉",
    moodSignals: ["想被接住", "需要情绪容器"],
    objectiveSignals: ["降低悬空感", "增加被包裹感"],
    constraints: ["不要太苦", "不要过度空旷"],
    queryHints: ["companion", "soft comfort", "warm"],
  },
  "排水放松": {
    state: "你需要的不是立刻振作，而是先把心里那层水慢慢排掉",
    moodSignals: ["想排水", "想放松"],
    objectiveSignals: ["降低紧绷", "先呼吸顺一点"],
    constraints: ["不要太炸", "不要推进太猛"],
    queryHints: ["recovery", "wind down", "healing"],
  },
  "稳定专注": {
    state: "你需要一个能把心神慢慢收回来的稳定面",
    moodSignals: ["想稳定", "想专注"],
    objectiveSignals: ["收拢注意力", "减少分心"],
    constraints: ["不要太吵", "歌词不要过密"],
    queryHints: ["focus", "steady groove", "productive night"],
  },
  "重新启动": {
    state: "你想要的不是被安慰完，而是能重新把生活接起来",
    moodSignals: ["想启动", "需要推进感"],
    objectiveSignals: ["重新进入状态", "把人带回生活节奏"],
    constraints: ["不要太软塌", "不要太丧"],
    queryHints: ["growth", "light groove", "restart"],
  },
  "柔软回暖": {
    state: "你真正想要的，是一点缓慢但可靠的回暖感",
    moodSignals: ["想回暖", "想被温柔对待"],
    objectiveSignals: ["恢复连接感", "把情绪慢慢暖回来"],
    constraints: ["避免太冷", "不要太锋利"],
    queryHints: ["warm", "gentle healing", "comfort"],
  },
  "放松一下": {
    state: "真正想要的不是更多刺激，而是先松下来",
    moodSignals: ["想卸力", "想放松"],
    objectiveSignals: ["降低紧绷感", "先舒服下来"],
    constraints: ["不要太炸", "不要过度推进"],
    queryHints: ["recovery", "wind down", "soft"],
  },
  "轻轻放松": {
    state: "更需要一个温柔缓冲带，而不是被继续推着走",
    moodSignals: ["想慢下来", "需要缓冲"],
    objectiveSignals: ["慢慢收尾", "把节奏降下来"],
    constraints: ["不要太吵", "避免情绪过猛"],
    queryHints: ["gentle", "soft landing", "warm"],
  },
  "找回力量": {
    state: "不是要立刻满格，而是想把自己稳稳接回来",
    moodSignals: ["回血", "恢复掌控感"],
    objectiveSignals: ["重新接回能量", "保持稳定提气"],
    constraints: ["不要鸡血式鼓励", "避免太硬"],
    queryHints: ["growth", "steady uplift", "rebuild"],
  },
  "继续发光": {
    state: "此刻更想守住那点亮度和锋芒",
    moodSignals: ["自我确认", "想继续在线"],
    objectiveSignals: ["放大存在感", "继续保持高光"],
    constraints: ["不要太浮夸", "保留高级感"],
    queryHints: ["glow", "confident", "stylish"],
  },
  "有人陪伴": {
    state: "你缺的不是答案，是一种有人并肩的感觉",
    moodSignals: ["想被陪着", "想被接住"],
    objectiveSignals: ["增加连接感", "降低孤单感"],
    constraints: ["不要太苦", "避免过度失恋叙事"],
    queryHints: ["companion", "warm", "side by side"],
  },
  "有人分享": {
    state: "你想要的不是独自消化，而是有人能听懂这一刻",
    moodSignals: ["想表达", "想共享状态"],
    objectiveSignals: ["让情绪有出口", "把体验讲出去"],
    constraints: ["避免太封闭", "不要过度孤独"],
    queryHints: ["share", "connection", "warm pop"],
  },
  "清空大脑": {
    state: "你现在最需要的，是先把脑内弹窗关掉",
    moodSignals: ["脑噪偏高", "想留白"],
    objectiveSignals: ["清理脑噪", "恢复呼吸感"],
    constraints: ["不要歌词过密", "不要再加信息量"],
    queryHints: ["reflection", "clear mind", "ambient"],
  },
  "奖励自己": {
    state: "今天值得被偏爱一下，而不是被匆匆带过",
    moodSignals: ["庆祝欲", "想被奖励"],
    objectiveSignals: ["放大愉悦", "给今天一个亮一点的结尾"],
    constraints: ["避免土味煽情", "不要太俗艳"],
    queryHints: ["celebrate", "bright pop", "glow"],
  },
  "把开心放大": {
    state: "你想延长的不是功能性恢复，而是这份难得的开心",
    moodSignals: ["开心", "轻盈", "想继续亮着"],
    objectiveSignals: ["延长好状态", "让快乐不那么快掉下来"],
    constraints: ["避免太苦", "保留明亮感"],
    queryHints: ["celebrate", "happy", "bright"],
  },
  "去探索一下": {
    state: "你真正想靠近的，是一点未知和新鲜感",
    moodSignals: ["探索欲", "想往外走"],
    objectiveSignals: ["打开感官", "让心往外扩一点"],
    constraints: ["避免太保守", "保留发现感"],
    queryHints: ["explore", "fresh", "city roam"],
  },
};

const IMAGERY_PROFILES: Record<string, ImageryProfile> = {
  雨夜窗边: { sceneSignals: ["雨夜", "窗边", "湿润空气"], queryHints: ["rainy night", "window"], sceneSummary: "很适合承接那些不想大声说出来的情绪" },
  夜晚散步: { sceneSignals: ["夜路", "散步", "晚风"], queryHints: ["late walk", "night"], sceneSummary: "像边走边把情绪从身体里慢慢散出去" },
  房间独处: { sceneSignals: ["房间", "独处", "低噪"], queryHints: ["indoor", "quiet room"], sceneSummary: "更像给自己一个不被打扰的缓冲层" },
  城市霓虹: { sceneSignals: ["霓虹", "都市", "夜色"], queryHints: ["city night", "neon"], sceneSummary: "适合把状态提起来，但不必过分张扬" },
  清晨通勤: { sceneSignals: ["清晨", "通勤", "车窗"], queryHints: ["morning commute", "subway"], sceneSummary: "像在一天真正开始前，先把自己调到更稳的频率上" },
  晚风海边: { sceneSignals: ["海边", "晚风", "开阔"], queryHints: ["beach road", "breezy"], sceneSummary: "有一点流动感，也有一点把情绪拉开的空间" },
  东京雨夜: { sceneSignals: ["雨夜", "窗边", "城市霓虹"], queryHints: ["rainy night", "wet air"], sceneSummary: "湿润、克制、适合慢慢回收情绪" },
  夏日晚风: { sceneSignals: ["晚风", "树影", "松弛"], queryHints: ["breezy", "late walk"], sceneSummary: "是那种能让人呼吸重新变轻的夜晚" },
  海边公路: { sceneSignals: ["海风", "公路", "往前流动"], queryHints: ["beach road", "road trip"], sceneSummary: "更像把视线拉开、把情绪重新带动起来" },
  深夜便利店: { sceneSignals: ["冷白灯", "小店", "独处"], queryHints: ["convenience store", "night"], sceneSummary: "简单、克制、带一点被城市托住的安全感" },
  城市灯光: { sceneSignals: ["高楼", "灯光", "城市还醒着"], queryHints: ["city night", "neon"], sceneSummary: "是一个人也不算太孤单的都市夜色" },
  天台晚霞: { sceneSignals: ["天台", "晚霞", "风"], queryHints: ["rooftop", "golden hour"], sceneSummary: "有一点通透，也有一点把心情抬起来的空间感" },
  公路兜风: { sceneSignals: ["公路", "车窗", "流动感"], queryHints: ["road window", "drive"], sceneSummary: "适合让情绪跟着节奏流起来，不要卡在原地" },
  海边晴空: { sceneSignals: ["海边", "晴空", "开阔"], queryHints: ["sunny beach", "wide open"], sceneSummary: "更偏开阔、明亮、会让人想重新伸展开来" },
  周末市集: { sceneSignals: ["市集", "灯串", "烟火气"], queryHints: ["market", "warm crowd"], sceneSummary: "有一点热闹，但不会压人，适合把人带回生活里" },
  展览白墙: { sceneSignals: ["展览", "白墙", "留白"], queryHints: ["gallery", "clean"], sceneSummary: "适合把注意力重新聚回来，也适合慢慢打开好奇心" },
  金色夕阳: { sceneSignals: ["落日", "金色", "回暖"], queryHints: ["golden hour", "sunny"], sceneSummary: "更像一天快结束时，被轻轻照亮一下" },
  游乐园夜场: { sceneSignals: ["彩灯", "热闹", "轻微兴奋"], queryHints: ["fairground", "night lights"], sceneSummary: "适合庆祝、适合放大开心，也适合让状态亮起来" },
  晴天草地: { sceneSignals: ["草地", "天光", "空气感"], queryHints: ["sunny grass", "fresh"], sceneSummary: "会把人带向更开阔、更轻盈的状态里" },
  清晨阳台: { sceneSignals: ["清晨", "柔光", "重新开始"], queryHints: ["morning light", "fresh start"], sceneSummary: "像给自己一个不必太用力的新起点" },
  街角花店: { sceneSignals: ["花店", "街角", "生活感"], queryHints: ["flower shop", "warm"], sceneSummary: "有一点温柔，也有一点把自己慢慢放回生活里的意思" },
  商场天台: { sceneSignals: ["商场天台", "夜色", "松感"], queryHints: ["rooftop", "city evening"], sceneSummary: "适合在城市里找到一点不必太赶的呼吸口" },
  夜跑河边: { sceneSignals: ["河边", "晚风", "身体在动"], queryHints: ["late walk", "riverside run"], sceneSummary: "更像边走边把脑子里的噪音散掉" },
  周末早午餐: { sceneSignals: ["早午餐", "慢节奏", "轻松"], queryHints: ["weekend brunch", "easy"], sceneSummary: "有一种不用着急证明什么的轻松感" },
  书店角落: { sceneSignals: ["书店", "安静角落", "注意力收回"], queryHints: ["bookstore", "quiet"], sceneSummary: "适合让心往里靠一点，也让注意力重新聚焦" },
  彩虹天光: { sceneSignals: ["彩虹", "天光", "轻盈"], queryHints: ["rainbow glow", "bright"], sceneSummary: "像生活突然给你留了一点不需要解释的漂亮" },
  夜市灯串: { sceneSignals: ["夜市", "灯串", "烟火气"], queryHints: ["night market", "lights"], sceneSummary: "是那种热闹但不喧哗、很有生活热度的夜晚" },
  公路车窗: { sceneSignals: ["车窗", "路灯", "节奏流动"], queryHints: ["road window", "city drive"], sceneSummary: "适合给情绪一点移动感，不被困在原地" },
  草地晴光: { sceneSignals: ["草地", "晴光", "发暖的风"], queryHints: ["sunny grass", "fresh air"], sceneSummary: "更像把心情摊开、让空气重新进来的状态" },
  咖啡店窗边: { sceneSignals: ["咖啡店", "窗边", "陪伴感"], queryHints: ["coffee shop", "window"], sceneSummary: "有一点独处，也有一点被城市陪着的感觉" },
};

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickVariant(key: string, variants: string[]): string {
  return variants[hashString(key) % variants.length];
}

function buildRulePlan(request: AotdRequest): AotdPlan {
  const { answers } = request;
  const source = SOURCE_PROFILES[answers.consumptionSource] || SOURCE_PROFILES.情绪压力;
  const need = NEED_PROFILES[answers.emotionalNeed] || NEED_PROFILES["轻轻放松"];
  const imagery = IMAGERY_PROFILES[answers.emotionalImagery] || IMAGERY_PROFILES.咖啡店窗边;
  const planKey = [answers.consumptionSource, answers.emotionalNeed, answers.emotionalImagery].join("|");

  const summary = pickVariant(planKey, [
    `今晚的你，不是简单的“${answers.consumptionSource}”，而是${source.state}；你现在真正想要的，是在${answers.emotionalImagery}这类场景里，慢慢走向${answers.emotionalNeed}。`,
    `如果把你今晚的状态翻成一句更接近内心的话，大概是：${source.state}，所以你会想靠近${answers.emotionalImagery}这种${imagery.sceneSummary}的空间，把自己带到“${answers.emotionalNeed}”里。`,
    `从这三道题看，你现在最核心的状态不是单一情绪标签，而是${source.state}；而${answers.emotionalImagery}之所以打动你，是因为它刚好能承接你想要的“${answers.emotionalNeed}”。`,
  ]);

  const intent = pickVariant(`${planKey}|intent`, [
    source.intent || `用户想把“${answers.emotionalNeed}”这件事更自然地发生在今晚。`,
    `用户需要一张能把“${answers.consumptionSource}”平稳转译到“${answers.emotionalNeed}”的歌单。`,
    `用户想把今晚放进“${answers.emotionalImagery}”这一层空气里，完成从${answers.consumptionSource}到${answers.emotionalNeed}的过渡。`,
  ]);

  return {
    consumptionSource: answers.consumptionSource,
    emotionalNeed: answers.emotionalNeed,
    emotionalImagery: answers.emotionalImagery,
    userIntent: intent,
    todayStateSummary: summary,
    moodSignals: unique([answers.consumptionSource, answers.emotionalNeed, ...source.moodSignals, ...need.moodSignals]),
    sceneSignals: unique([answers.emotionalImagery, ...imagery.sceneSignals]),
    objectiveSignals: unique([...source.objectiveSignals, ...need.objectiveSignals]),
    constraints: unique([...source.constraints, ...need.constraints, "避免和用户当前场景完全跳脱"]),
    playlistStrategy: `先用规则抽取锁定“${answers.consumptionSource} -> ${answers.emotionalNeed} -> ${answers.emotionalImagery}”的状态路径，再用模型补充更细的语义信号与推荐理由。`,
    queryHints: unique([answers.consumptionSource, answers.emotionalNeed, answers.emotionalImagery, ...source.queryHints, ...need.queryHints, ...imagery.queryHints]),
    explanationStyle: "像一名理解状态的心理咨询师，先识别，再安放，最后给出有陪伴感的推荐理由。",
    uncertainty: [],
  };
}

function mergePlan(basePlan: AotdPlan, modelPlan: AotdPlan): AotdPlan {
  const mergedSummary =
    modelPlan.todayStateSummary &&
    modelPlan.todayStateSummary !== basePlan.todayStateSummary &&
    modelPlan.todayStateSummary.length >= 24
      ? `${basePlan.todayStateSummary} ${modelPlan.todayStateSummary}`
      : basePlan.todayStateSummary;

  return {
    consumptionSource: basePlan.consumptionSource,
    emotionalNeed: basePlan.emotionalNeed,
    emotionalImagery: basePlan.emotionalImagery,
    userIntent: modelPlan.userIntent || basePlan.userIntent,
    todayStateSummary: mergedSummary,
    moodSignals: unique(basePlan.moodSignals.concat(modelPlan.moodSignals || [])).slice(0, 8),
    sceneSignals: unique(basePlan.sceneSignals.concat(modelPlan.sceneSignals || [])).slice(0, 8),
    objectiveSignals: unique(basePlan.objectiveSignals.concat(modelPlan.objectiveSignals || [])).slice(0, 8),
    constraints: unique(basePlan.constraints.concat(modelPlan.constraints || [])).slice(0, 8),
    playlistStrategy: modelPlan.playlistStrategy || basePlan.playlistStrategy,
    queryHints: unique(basePlan.queryHints.concat(modelPlan.queryHints || [])).slice(0, 12),
    explanationStyle: modelPlan.explanationStyle || basePlan.explanationStyle,
    uncertainty: unique((modelPlan.uncertainty || []).concat(basePlan.uncertainty)),
  };
}

function buildFallbackPlan(request: AotdRequest, reason: string): AotdPlan {
  const plan = buildRulePlan(request);
  return {
    ...plan,
    uncertainty: unique(plan.uncertainty.concat([reason])),
  };
}

export class AotdPlanner {
  private readonly runtime: ClaudeStyleAgentRuntime;

  constructor(client: LLMClient) {
    this.runtime = new ClaudeStyleAgentRuntime({
      client,
      systemPrompt: buildAotdSystemPrompt(),
      seedMessages: buildFewShotMessages(aotdFewShotExamples),
    });
  }

  async plan(request: AotdRequest): Promise<AotdPlan> {
    const questionnaireInput = renderQuestionnaireAnswers(request.answers);
    const rulePlan = buildRulePlan(request);
    const raw = await this.runtime.run(
      [
        "以下是用户完成 AOTD 三道题后的答案：",
        questionnaireInput,
        "以下是规则抽取出的基础判断，请在不偏离答案的前提下做更细腻的补充：",
        JSON.stringify(rulePlan, null, 2),
        "请基于 few-shot 样例输出 AOTD 选歌计划 JSON。",
        "字段必须包括：consumptionSource, emotionalNeed, emotionalImagery, userIntent, todayStateSummary, moodSignals, sceneSignals, objectiveSignals, constraints, playlistStrategy, queryHints, explanationStyle, uncertainty。",
      ].join("\n"),
    );

    try {
      const parsed = JSON.parse(raw);
      const result = AotdPlanSchema.safeParse(parsed);
      if (result.success) {
        return mergePlan(rulePlan, result.data);
      }

      return buildFallbackPlan(request, `模型返回的计划字段不完整，已切换到兜底选歌逻辑。`);
    } catch {
      return buildFallbackPlan(request, "模型返回结果无法解析为 JSON，已切换到兜底选歌逻辑。");
    }
  }
}
