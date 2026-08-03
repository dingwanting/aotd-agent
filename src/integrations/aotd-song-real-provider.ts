import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../config/env.js";
import { cacheNeteaseTrackPreviews } from "./netease.js";
import { cacheRemoteAudioToLocal, persistBase64FileToProject, uploadBase64FileToSuno } from "./suno-file-transfer.js";

import type { GenerateAotdSongParams, GeneratedAotdSong } from "./aotd-song-provider.js";

interface RemoteSongResponse {
  code?: number;
  msg?: string;
  status?: string;
  callbackType?: string;
  taskId?: string;
  id?: string;
  audioUrl?: string;
  audio_url?: string;
  source_audio_url?: string;
  voiceSampleUrl?: string;
  voice_sample_url?: string;
  title?: string;
  summary?: string;
  durationSeconds?: number;
  duration_seconds?: number;
  data?: {
    taskId?: string;
    status?: string;
    callbackType?: string;
    task_id?: string;
    data?: Array<{
      id?: string;
      audio_url?: string;
      audioUrl?: string;
      streamAudioUrl?: string;
      sourceStreamAudioUrl?: string;
      source_audio_url?: string;
      title?: string;
      tags?: string;
      prompt?: string;
      duration?: number;
      durationSeconds?: number;
    }>;
    response?: {
      data?: Array<{
        id?: string;
        audio_url?: string;
        audioUrl?: string;
        streamAudioUrl?: string;
        sourceStreamAudioUrl?: string;
        title?: string;
        tags?: string;
        prompt?: string;
        duration?: number;
        durationSeconds?: number;
        image_url?: string;
      }>;
      sunoData?: Array<{
        id?: string;
        audioUrl?: string;
        streamAudioUrl?: string;
        sourceStreamAudioUrl?: string;
        sourceAudioUrl?: string | null;
        title?: string;
        tags?: string;
        prompt?: string;
        duration?: number | null;
        createTime?: number;
      }>;
    };
  };
  error?: string | { message?: string };
}

interface NormalizedRemoteTrack {
  audioUrl: string;
  title?: string;
  tags?: string;
  duration?: number;
}

const CREATE_TIMEOUT_MS = 35000;
const STATUS_TIMEOUT_MS = 25000;
const MAX_PROVIDER_POLLS = 110;
const STATUS_FETCH_RETRY_LIMIT = 4;
const STATUS_FETCH_RETRY_BASE_DELAY_MS = 1200;
const MAX_TRANSIENT_STATUS_ERROR_STREAK = 8;
const MAX_SUNO_STYLE_LENGTH = 920;
const MAX_SUNO_STYLE_SEGMENT_LENGTH = 180;
const TARGET_AOTD_SONG_DURATION_SECONDS = 45;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const generatedAudioRoot = path.join(projectRoot, "web", "generated", "aotd-song");

const VOCAL_PROFILE_CONFIG = {
  male: {
    label: "男声",
    promptLine: "人声方向偏温暖成熟的男声主唱，贴耳、低动态、像下班后在耳边轻声说话，不要高亢喊唱。",
    styleTag: "warm male vocal, intimate male lead, breathy close-mic vocal, soft chest voice, no belting",
    lyricLine: "整体唱腔更靠近成熟男声，轻一点、近一点、松一点，不要太尖太薄，不要唱成激昂大歌。",
    vocalGender: "m",
  },
  female: {
    label: "女声",
    promptLine: "人声方向偏柔和清晰的女声主唱，细腻、靠前、轻声呢喃，有夜晚陪伴感，不要高音爆发。",
    styleTag: "soft female vocal, intimate female lead, whispery close-mic vocal, restrained dynamics, no belting",
    lyricLine: "整体唱腔更靠近柔和女声，清晰但不要过甜，要像轻声陪伴，不要唱成振奋型副歌。",
    vocalGender: "f",
  },
  duet: {
    label: "合唱",
    promptLine: "人声方向做成双人对唱或小合唱，副歌要有叠唱和和声层次。",
    styleTag: "duet vocal, layered harmonies, chorus vocal",
    lyricLine: "副歌请加入明显的双声部或合唱感，层次要温柔饱满。",
    vocalGender: "",
  },
  child: {
    label: "儿童音",
    promptLine: "人声方向偏清亮轻盈的儿童音色，纯净、真诚、轻声，不要做成卡通、喊唱或搞怪效果。",
    styleTag: "child-like vocal, bright innocent tone, soft close-mic singing, restrained dynamics",
    lyricLine: "整体唱腔更轻、更亮，保留童声的纯净感，但不要幼稚搞怪，也不要做成很亢奋的唱法。",
    vocalGender: "",
  },
  foreign: {
    label: "外国人",
    promptLine: "人声方向偏海外流行唱腔，可以带一点英文句子或轻微异国口音感，但整体仍要贴耳、松弛、轻唱。",
    styleTag: "global pop vocal, subtle foreign accent, bilingual phrasing, airy intimate vocal, soft dynamics",
    lyricLine: "允许中英混合或少量英文 hook，让唱腔更像海外流行歌手，但不要做成热血美式大歌。",
    vocalGender: "",
  },
} as const;

interface StylePersonaProfile {
  label: string;
  styleName: string;
  styleTags: string;
  productionHint: string;
  lyricHint: string;
  lyricPointOfView: string;
  lyricSentenceRhythm: string;
  hookPattern: string;
  imageryLexicon: string[];
  forbiddenLyricMoves: string[];
  verseTemplate: string[];
  preChorusTemplate: string[];
  hookTemplate: string[];
  bpmRange: string;
  groove: string;
  coreInstruments: string[];
  drumHint: string;
  harmonyDensity: string;
  bassMotion: string;
  mixMood: string;
  keywords: string[];
}

export interface AotdSongStyleHit {
  label: string;
  styleName: string;
  summary: string;
  reason: string;
}

const STYLE_PERSONA_PROFILES: StylePersonaProfile[] = [
  {
    label: "下班治愈",
    styleName: "Evening R&B",
    styleTags: "warm intimate R&B, neo soul, lo-fi, evening commute, soft emotional delivery",
    productionHint: "做成下班路上的治愈小歌，modern R&B + neo soul + lo-fi，70-75 BPM，electric piano、soft bass、light drums、ambient texture，整首歌要像朋友陪着走回家。",
    lyricHint: "歌词像一个朋友陪着你慢慢松下来，安静、体贴、不过度抒情。",
    lyricPointOfView: "第二人称为主，像有人并肩走在你旁边低声说话。",
    lyricSentenceRhythm: "短句、轻句、留白多，像晚风里慢慢说出口。",
    hookPattern: "副歌把标题写成被安慰、被陪伴、慢慢放松的事实，不要做成大副歌。",
    imageryLexicon: ["晚风", "耳机", "路灯", "肩膀", "电车", "步伐", "呼吸"],
    forbiddenLyricMoves: ["不要 powerful vocals", "不要 dramatic chorus", "不要 80s pop style", "不要 big orchestra"],
    verseTemplate: ["今天被{source}推着走了很久", "走到{scene}里才发现肩膀一直没有放下来", "如果你愿意 就先慢慢靠近{need}"],
    preChorusTemplate: ["先别急着变好", "先让呼吸回到身体里", "像有人陪你把这段路走完"],
    hookTemplate: ["让我从{source}慢慢走到{need}", "晚风和路灯在身边轻轻陪我", "把标题写成今晚真的被温柔接住"],
    bpmRange: "70-75 BPM",
    groove: "laid-back modern R&B pocket with neo soul softness",
    coreInstruments: ["electric piano", "soft bass", "light drums", "ambient texture"],
    drumHint: "鼓要很轻，边鼓和 kick 都收住，不要 punchy，不要炸。",
    harmonyDensity: "中等偏柔和，和弦温暖但不过满",
    bassMotion: "低频贴着人声慢慢走，不要跳太多",
    mixMood: "comforting、peaceful、intimate，像朋友在身边陪你散步",
    keywords: ["下班", "治愈", "放松", "轻声", "陪伴", "朋友", "晚风", "通勤", "松下来"],
  },
  {
    label: "城市夜晚",
    styleName: "City Pop / Electronic R&B",
    styleTags: "nighttime city walk soundtrack, city pop, modern electronic R&B, neon lights, subway, late-night city",
    productionHint: "做成城市夜晚散步 soundtrack，95 BPM，City Pop 混合 modern electronic R&B，用 synth bass、analog synth、clean guitar、electronic drums，像地铁、霓虹和夜风一起移动。",
    lyricHint: "歌词要有城市夜色、车窗反光、地铁和霓虹的镜头感。",
    lyricPointOfView: "第一人称，像边走边观察这座夜里的城市。",
    lyricSentenceRhythm: "中短句流动往前，像夜里走路时的内心旁白。",
    hookPattern: "副歌写成城市夜行里的情绪状态，不要戏剧化，不要高音冲顶。",
    imageryLexicon: ["霓虹", "地铁", "车窗", "高架", "夜风", "街灯", "隧道"],
    forbiddenLyricMoves: ["不要 ballad", "不要 high pitch vocal", "不要 dramatic singing"],
    verseTemplate: ["我沿着{scene}的灯继续往前走", "地铁和车窗把白天的{source}拉得很远", "霓虹落在袖口上 心情也慢慢变轻"],
    preChorusTemplate: ["城市还没有睡", "我想把脚步再放慢一点", "让自己慢慢靠近{need}"],
    hookTemplate: ["把{source}留在几个街口之前", "让{scene}陪我走进更轻一点的夜里", "把标题写成霓虹下慢慢松开的身体和心情"],
    bpmRange: "95 BPM",
    groove: "steady city pop pulse mixed with modern electronic R&B glide",
    coreInstruments: ["synth bass", "analog synth", "clean guitar", "electronic drums"],
    drumHint: "电子鼓要干净、轻盈、有夜行律动，不要做成大鼓大镲。",
    harmonyDensity: "中等，和声顺滑、现代、略带霓虹感",
    bassMotion: "合成器 bass 稳定流动，带一点城市夜行的推进感",
    mixMood: "neon lights、subway、late-night city，明亮但不刺耳",
    keywords: ["城市", "夜晚", "霓虹", "地铁", "车窗", "通勤", "夜路", "夜色"],
  },
  {
    label: "重新充电",
    styleName: "Modern Indie Pop",
    styleTags: "modern inspirational indie pop, quiet confidence, starting again tomorrow, not a stadium anthem",
    productionHint: "做成 modern inspirational indie pop，但不是 stadium anthem，100 BPM，guitar、organic drums、light synth，给人 quiet confidence 和明天重新开始的感觉。",
    lyricHint: "歌词是安静地把自己重新充上电，不要热血演讲，也不要苦情。",
    lyricPointOfView: "第一人称，像写给明天自己的小备忘录。",
    lyricSentenceRhythm: "句子干净、自然、有一点向前走的节奏，但不要喊口号。",
    hookPattern: "副歌写成重新找回气力和秩序，不要做成体育场提气副歌。",
    imageryLexicon: ["鞋带", "台阶", "清晨", "窗边", "深呼吸", "明天", "起点"],
    forbiddenLyricMoves: ["不要 stadium anthem", "不要 power chorus", "不要热血励志演讲"],
    verseTemplate: ["今天的{source}把我磨得有点慢", "但我还想把明天重新放回手里", "先把呼吸和脚步慢慢调回自己的节奏"],
    preChorusTemplate: ["不是现在就要冲出去", "只是想把身体重新充上电", "让{need}成为明天会继续的方向"],
    hookTemplate: ["我会从{source}里慢慢回到自己", "把{scene}当成重新启动前的安静时刻", "把标题写成明天还能继续往前走的 quiet confidence"],
    bpmRange: "100 BPM",
    groove: "organic indie pop pulse with relaxed forward motion",
    coreInstruments: ["guitar", "organic drums", "light synth"],
    drumHint: "鼓要有自然推进感，但绝不做成体育场大鼓。",
    harmonyDensity: "中等偏简洁，让旋律和气口更自然",
    bassMotion: "低频只做托举，不用强推",
    mixMood: "quiet confidence、starting again tomorrow，清爽但克制",
    keywords: ["重新开始", "重新充电", "明天", "安静自信", "恢复", "调整", "站稳"],
  },
  {
    label: "深夜独处",
    styleName: "Minimal Piano Jazz Ballad",
    styleTags: "minimal piano jazz ballad, late night coffee shop, intimate thinking about life, low and close",
    productionHint: "做成极简 piano jazz ballad，60 BPM，用 piano、upright bass、brush drums、saxophone，像深夜咖啡店里坐着想事情。",
    lyricHint: "歌词更像深夜独处时轻轻想清楚一件事，安静、缓慢、有停顿。",
    lyricPointOfView: "第一人称，像对自己低声说话。",
    lyricSentenceRhythm: "长短句交替，停顿感明显，像夜里慢慢思考。",
    hookPattern: "副歌不是流行大 Hook，而是一句低声落下来的结论。",
    imageryLexicon: ["咖啡店", "钢琴", "雨点", "杯壁", "桌灯", "窗边", "夜深"],
    forbiddenLyricMoves: ["不要 power vocals", "不要 pop chorus", "不要 female diva vocal"],
    verseTemplate: ["夜深以后 {scene}变得安静很多", "白天关于{source}的回声还在心里轻轻打转", "我坐下来想把今天慢慢想明白"],
    preChorusTemplate: ["不用现在就回答所有问题", "先听钢琴和呼吸把速度放慢", "再轻轻想起{need}的样子"],
    hookTemplate: ["让{scene}陪我把心跳放到更低一点", "把{source}留在夜色外面慢慢退场", "把标题写成深夜终于说给自己听的话"],
    bpmRange: "60 BPM",
    groove: "minimal piano jazz ballad with brushed drums and spacious pauses",
    coreInstruments: ["piano", "upright bass", "brush drums", "saxophone"],
    drumHint: "鼓只有刷镲和轻触，保持咖啡店式呼吸感。",
    harmonyDensity: "较丰富但稀疏，和声细腻、留白明显",
    bassMotion: "upright bass 轻轻托住，不抢戏",
    mixMood: "late night coffee shop、thinking about life、low and intimate",
    keywords: ["深夜", "独处", "咖啡店", "想事情", "人生", "安静", "夜深", "一个人"],
  },
  {
    label: "快乐奖励",
    styleName: "K-pop / Funk Pop",
    styleTags: "fresh upbeat pop, k-pop inspired, funk pop, Friday evening, freedom, sunset, bright but controlled",
    productionHint: "做成 fresh upbeat pop，K-pop inspired + funk pop，115 BPM，用 bass groove、funk guitar、bright synth，像周五傍晚自由下班时给自己的奖励。",
    lyricHint: "歌词要轻快、俏皮、松弛，像晚霞里终于能开心一下，但不要戏剧化。",
    lyricPointOfView: "第一人称，像在记录周五傍晚的小自由。",
    lyricSentenceRhythm: "句子更短、更亮、更上口，但控制动态，不要喊。",
    hookPattern: "副歌要轻快有记忆点，但不能 dramatic，只能 bright and fun。",
    imageryLexicon: ["周五", "落日", "晚霞", "自由", "笑意", "街角", "晚风"],
    forbiddenLyricMoves: ["不要 emotional ballad", "不要 dramatic vocals", "不要 power belting"],
    verseTemplate: ["忙完一整天的{source}以后", "我终于能在{scene}里把笑意慢慢找回来", "像给自己补上一点轻松和自由"],
    preChorusTemplate: ["不用把快乐唱得太满", "让身体先轻轻跟着 groove 走", "再慢慢靠近{need}"],
    hookTemplate: ["把{source}留在今天的身后", "让{scene}和晚霞陪我把心情点亮", "把标题写成周五傍晚那种轻快的小奖励"],
    bpmRange: "115 BPM",
    groove: "fresh upbeat pop groove with k-pop polish and funk bounce",
    coreInstruments: ["bass groove", "funk guitar", "bright synth"],
    drumHint: "鼓可以轻快，但别做成 festival 式大冲击。",
    harmonyDensity: "中等偏亮，副歌可以更抓耳但要控制层次",
    bassMotion: "bass groove 清晰弹跳，别太重",
    mixMood: "Friday evening、freedom、sunset，playful and energetic but not dramatic",
    keywords: ["快乐", "奖励", "周五", "自由", "晚霞", "落日", "开心", "轻快"],
  },
];

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function normalizePath(pathTemplate: string, taskId?: string): string {
  const filled = taskId ? pathTemplate.replaceAll("{taskId}", encodeURIComponent(taskId)) : pathTemplate;
  return filled.startsWith("/") ? filled : `/${filled}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProviderPollIntervalMs(attempt: number): number {
  if (attempt < 10) {
    return 2500;
  }
  if (attempt < 30) {
    return 3500;
  }
  return 4500;
}

function resolveDurationCapableModel(model?: string): string {
  const normalized = String(model || "").trim();
  if (normalized === "V5_5") {
    return normalized;
  }
  return TARGET_AOTD_SONG_DURATION_SECONDS > 0 ? "V5_5" : normalized || "V4_5ALL";
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9-_]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }
  if (record.error && typeof record.error === "object" && "message" in record.error && typeof record.error.message === "string") {
    return record.error.message;
  }
  if (typeof record.msg === "string" && record.msg.trim()) {
    return record.msg.trim();
  }
  return fallback;
}

export function extractRemoteSongErrorMessage(payload: unknown, fallback: string): string {
  return extractErrorMessage(payload, fallback);
}

function isRetryableFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /fetch failed|timeout|timed out|network|socket|econnreset|enotfound|eai_again/i.test(message);
}

function buildCallbackUrl(request: GenerateAotdSongParams, env: ReturnType<typeof loadEnv>): string {
  return request.callbackUrl || env.aotdSongCallbackUrl || "https://example.com/api/aotd-song/callback";
}

export function buildLocalVoiceSamplePath(params: Pick<GenerateAotdSongParams, "titleText" | "playlistTitle" | "voiceBase64" | "voiceFormat">): string {
  const voiceFormat = sanitizeName(params.voiceFormat || "mp3") || "mp3";
  const fileToken = crypto
    .createHash("sha1")
    .update(`${params.titleText}|${params.playlistTitle}|${params.voiceBase64.slice(0, 128)}`)
    .digest("hex")
    .slice(0, 16);
  const fileName = `${sanitizeName(params.titleText || "aotd-voice") || "aotd-voice"}-${fileToken}.${voiceFormat}`;
  return `/generated/aotd-song/voice-samples/${fileName}`;
}

function getVocalProfileConfig(request: GenerateAotdSongParams) {
  const profile = request.vocalProfile || "female";
  return VOCAL_PROFILE_CONFIG[profile] || VOCAL_PROFILE_CONFIG.female;
}

function buildLyricLanguageLine(request: GenerateAotdSongParams): string {
  if (request.vocalProfile === "foreign") {
    return "歌词允许中英混合，保留海外流行唱腔和英文 hook。";
  }
  return "优先中文歌词，语气自然，不要过度煽情。";
}

function buildVocalDirectionLine(request: GenerateAotdSongParams): string {
  return getVocalProfileConfig(request).promptLine;
}

function buildAfterWorkSoftnessGuide(request: GenerateAotdSongParams): string {
  const vocalLabel = getVocalProfileConfig(request).label;
  const [primary] = inferStylePersonas(request);
  if (primary?.label === "快乐奖励") {
    return (
      `整体听感要像周五傍晚给自己的小奖励。即使选择${vocalLabel}，也不要做成戏剧化大歌。` +
      "人声保持轻快、贴耳、明亮，但不要 power vocal，不要 belting，不要 dramatic vocals。" +
      "编曲可以更有 groove，但副歌不能炸开，保持 bright and fun，而不是振奋喊唱。"
    );
  }
  if (primary?.label === "重新充电") {
    return (
      `整体听感要有 quiet confidence。即使选择${vocalLabel}，也不要做成体育场 anthem。` +
      "人声自然、松弛、不过分煽情，像在给明天的自己轻轻打气。" +
      "编曲要有向前感，但不能出现大开大合的提气副歌。"
    );
  }
  if (primary?.label === "城市夜晚") {
    return (
      `整体听感要像城市夜晚散步 soundtrack。即使选择${vocalLabel}，也不要高音冲顶。` +
      "人声尽量轻、近、whispery，像霓虹和地铁声旁边的内心旁白。" +
      "编曲保留夜行律动，但不要 dramatic singing，不要流行情歌式大起伏。"
    );
  }
  if (primary?.label === "深夜独处") {
    return (
      `整体听感要像深夜咖啡店里的极简独处。即使选择${vocalLabel}，也不要做成 diva 或 power ballad。` +
      "人声要低、近、轻，像坐在桌边低声说话。" +
      "编曲极简，钢琴和刷镲留白更多，不要流行大副歌。"
    );
  }
  return (
    `整体听感必须是下班后放松、轻声呢喃、近场陪伴。即使选择${vocalLabel}，也不要做成高亢、激昂、振奋的大歌。` +
    "人声要像贴耳低声说话，动态收住，少爆发，少喊唱，少大开大合。" +
    "编曲维持中低能量，鼓和低频克制，副歌不要突然炸开，不要体育场合唱感，不要励志提气感。"
  );
}

function buildAfterWorkStyleTokens(request: GenerateAotdSongParams): string {
  const [primary] = inferStylePersonas(request);
  if (primary?.label === "快乐奖励") {
    return [
      "Friday evening reward",
      "bright but controlled",
      "playful groove",
      "light upbeat energy",
      "no dramatic vocals",
      "no power belting",
      "no explosive chorus",
    ].join(", ");
  }
  if (primary?.label === "重新充电") {
    return [
      "quiet confidence",
      "starting again tomorrow",
      "organic indie pop",
      "relaxed male/female delivery",
      "not a stadium anthem",
      "no explosive chorus",
    ].join(", ");
  }
  if (primary?.label === "城市夜晚") {
    return [
      "nighttime city walk",
      "neon lights",
      "subway mood",
      "soft whisper vocal",
      "late-night city",
      "no dramatic singing",
      "no high pitch vocal",
    ].join(", ");
  }
  if (primary?.label === "深夜独处") {
    return [
      "late night coffee shop",
      "minimal piano jazz ballad",
      "low and intimate",
      "thinking about life",
      "no pop chorus",
      "no diva vocal",
      "no power vocals",
    ].join(", ");
  }
  return [
    "after-work unwind",
    "warm intimate R&B",
    "friend walking beside me",
    "intimate close-mic vocal",
    "soft emotional delivery",
    "no belting",
    "no dramatic chorus",
    "no big orchestra",
  ].join(", ");
}

function countKeywordHits(text: string, keywords: string[]): number {
  return keywords.reduce((score, keyword) => (text.includes(keyword) ? score + 1 : score), 0);
}

function findStylePersonaProfile(label: string): StylePersonaProfile | undefined {
  return STYLE_PERSONA_PROFILES.find((item) => item.label === label);
}

function resolvePrimaryStyleProfile(request: GenerateAotdSongParams): StylePersonaProfile {
  return inferStylePersonas(request)[0] || STYLE_PERSONA_PROFILES[0];
}

function pickCompanionStyleProfile(primaryLabel: string): StylePersonaProfile | undefined {
  const labelMap: Record<string, string> = {
    下班治愈: "城市夜晚",
    城市夜晚: "下班治愈",
    重新充电: "下班治愈",
    深夜独处: "下班治愈",
    快乐奖励: "城市夜晚",
  };
  const companionLabel = labelMap[primaryLabel];
  return companionLabel ? findStylePersonaProfile(companionLabel) : undefined;
}

function buildAnswerSignals(answers?: GenerateAotdSongParams["answers"]) {
  return {
    sourceText: String(answers?.consumptionSource || ""),
    needText: String(answers?.emotionalNeed || ""),
    imageryText: String(answers?.emotionalImagery || ""),
    combinedText: [answers?.consumptionSource, answers?.emotionalNeed, answers?.emotionalImagery].filter(Boolean).join(" "),
  };
}

function scoreExplicitAnswerStyleRule(profile: StylePersonaProfile, request: GenerateAotdSongParams): number {
  const signals = buildAnswerSignals(request.answers);
  const { sourceText, needText, imageryText } = signals;
  switch (profile.label) {
    case "下班治愈":
      return (
        (/下班|通勤|开会|加班|工作|疲惫|很累|消耗|掏空|透支/.test(sourceText) ? 2 : 0) +
        (/放松|治愈|抱抱|陪伴|缓一缓|休息|被接住|慢下来|松一点|轻一点/.test(needText) ? 4 : 0) +
        (/晚风|路灯|回家|散步|夜路|耳机|街边/.test(imageryText) ? 2 : 0)
      );
    case "城市夜晚":
      return (
        (/通勤|地铁|公交|路上|城市/.test(sourceText) ? 1 : 0) +
        (/放空|散步|走一走|夜游|吹风/.test(needText) ? 2 : 0) +
        (/霓虹|地铁|车窗|高架|街灯|城市|夜色|夜晚|街口|隧道/.test(imageryText) ? 4 : 0)
      );
    case "重新充电":
      return (
        (/消耗|疲惫|低电量|没电|透支|筋疲力尽/.test(sourceText) ? 1 : 0) +
        (/重新开始|重启|充电|恢复|缓过来|找回节奏|明天|调整状态|稳定|继续往前/.test(needText) ? 4 : 0) +
        (/清晨|窗边|台阶|明天|起点/.test(imageryText) ? 1 : 0)
      );
    case "深夜独处":
      return (
        (/想太多|信息过载|内耗|情绪很多|睡不着/.test(sourceText) ? 1 : 0) +
        (/想清楚|清空大脑|安静|独处|自己待会|思考|消化一下/.test(needText) ? 3 : 0) +
        (/深夜|咖啡店|窗边|雨夜|房间|桌灯|一个人|夜深/.test(imageryText) ? 4 : 0)
      );
    case "快乐奖励":
      return (
        (/周五|终于下班|忙完|辛苦一天/.test(sourceText) ? 1 : 0) +
        (/开心|奖励|庆祝|自由|放肆|开心一下|玩一下|轻快/.test(needText) ? 4 : 0) +
        (/晚霞|落日|周五|傍晚|街角|自由|sunset/.test(imageryText) ? 3 : 0)
      );
    default:
      return 0;
  }
}

function buildStyleHitReason(profile: StylePersonaProfile, request: GenerateAotdSongParams): string {
  const signals = buildAnswerSignals(request.answers);
  const reasons: string[] = [];
  switch (profile.label) {
    case "下班治愈":
      if (signals.needText) {
        reasons.push(`更贴近你想要的“${signals.needText}”`);
      }
      if (signals.imageryText) {
        reasons.push(`画面落在“${signals.imageryText}”这种回家路上的松弛感`);
      }
      break;
    case "城市夜晚":
      if (signals.imageryText) {
        reasons.push(`画面更像“${signals.imageryText}”这种城市夜行场景`);
      }
      if (signals.sourceText) {
        reasons.push(`也承接了“${signals.sourceText}”带来的通勤余韵`);
      }
      break;
    case "重新充电":
      if (signals.needText) {
        reasons.push(`更像你现在想要的“${signals.needText}”这种重新整理状态`);
      }
      if (signals.sourceText) {
        reasons.push(`也回应了“${signals.sourceText}”后的低电量感`);
      }
      break;
    case "深夜独处":
      if (signals.imageryText) {
        reasons.push(`画面直接落在“${signals.imageryText}”这种深夜独处场景`);
      }
      if (signals.needText) {
        reasons.push(`也贴近你想“${signals.needText}”的安静心境`);
      }
      break;
    case "快乐奖励":
      if (signals.needText) {
        reasons.push(`更贴近你想要“${signals.needText}”这种轻快奖励感`);
      }
      if (signals.imageryText) {
        reasons.push(`画面也和“${signals.imageryText}”这种傍晚自由时刻一致`);
      }
      break;
    default:
      break;
  }
  return reasons.join("，") || `这次更接近 ${profile.label} 的主气质。`;
}

function inferStylePersonas(request: GenerateAotdSongParams): StylePersonaProfile[] {
  const answers = request.answers;
  const answerSignals = buildAnswerSignals(answers);
  const answerText = answerSignals.combinedText;
  const trackText = request.tracks
    .flatMap((track) => [track.genre || "", ...(track.moods || []), ...(track.scenes || []), ...(track.tags || [])])
    .join(" ");

  const explicitReleaseIntent = /庆祝|奖励|开心|快乐|自由|周五|落日|晚霞|兴奋/.test(answerText);
  const restartIntent = /重新|明天|开始|充电|恢复|调整|站稳/.test(answerText);
  const solitudeIntent = /深夜|独处|咖啡店|一个人|想想|安静|夜深/.test(answerText);
  const explicitRanked = STYLE_PERSONA_PROFILES
    .map((profile) => ({
      profile,
      score: scoreExplicitAnswerStyleRule(profile, request),
    }))
    .sort((left, right) => right.score - left.score);
  const strongestExplicit = explicitRanked[0];
  if (strongestExplicit && strongestExplicit.score >= 4) {
    const companion = pickCompanionStyleProfile(strongestExplicit.profile.label);
    return companion ? [strongestExplicit.profile, companion] : [strongestExplicit.profile];
  }

  const ranked = STYLE_PERSONA_PROFILES
    .map((profile) => ({
      profile,
      score:
        countKeywordHits(answerText, profile.keywords) * 3 +
        countKeywordHits(trackText, profile.keywords) +
        scoreExplicitAnswerStyleRule(profile, request) * 2 +
        (profile.label === "快乐奖励" && explicitReleaseIntent ? 2 : 0) +
        (profile.label === "重新充电" && restartIntent ? 2 : 0) +
        (profile.label === "深夜独处" && solitudeIntent ? 2 : 0) +
        (profile.label === "下班治愈" ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score);

  const matched = ranked.filter((item) => item.score > 0).map((item) => item.profile);
  if (matched.length >= 2) {
    return matched.slice(0, 2);
  }
  if (matched.length === 1) {
    const fallback =
      request.tracks.filter((track) => track.energy === "low").length >= 3
        ? STYLE_PERSONA_PROFILES.find((item) => item.label === "深夜独处")
        : explicitReleaseIntent
          ? STYLE_PERSONA_PROFILES.find((item) => item.label === "快乐奖励")
          : restartIntent
            ? STYLE_PERSONA_PROFILES.find((item) => item.label === "重新充电")
            : STYLE_PERSONA_PROFILES.find((item) => item.label === "下班治愈");
    return fallback && fallback.label !== matched[0].label ? [matched[0], fallback] : matched;
  }
  return [STYLE_PERSONA_PROFILES[0], STYLE_PERSONA_PROFILES[1]];
}

export function resolveAotdSongStyleHit(request: GenerateAotdSongParams): AotdSongStyleHit {
  const profile = resolvePrimaryStyleProfile(request);
  return {
    label: profile.label,
    styleName: profile.styleName,
    summary: `${profile.label} · ${profile.styleName}`,
    reason: buildStyleHitReason(profile, request),
  };
}

function buildPrimaryStyleExecutionGuide(request: GenerateAotdSongParams): string {
  const primary = resolvePrimaryStyleProfile(request);
  switch (primary.label) {
    case "快乐奖励":
      return [
        "这次必须优先执行 快乐奖励 / K-pop / Funk Pop 模板，而不是泛流行模板。",
        "结构上做成轻快、抓耳、短句 hook，强调 bass groove + funk guitar + bright synth。",
        "女声或男声都只能轻快贴耳，不能 belting，不能 dramatic，不能做成情绪大抒情。",
        "如果 K-pop 与 funk pop 只能保住一个，优先保住 funk groove 和明亮流行律动，不要退化成普通华语抒情歌。",
      ].join("");
    case "深夜独处":
      return [
        "这次必须优先执行 深夜独处 / Minimal Piano Jazz Ballad 模板。",
        "结构上以 piano、upright bass、brush drums、少量 saxophone 为主，留白必须明显。",
        "不要做流行大副歌，不要做女 diva，不要做 power ballad，重点是低声、靠前、像在桌边说话。",
      ].join("");
    case "重新充电":
      return [
        "这次必须优先执行 重新充电 / Modern Indie Pop 模板。",
        "重点是 quiet confidence，不是热血提气；鼓和吉他要自然往前，但不能 stadium anthem。",
        "如果旋律有抬头感，也只能是轻轻提气，不能做成 triumphant climax。",
      ].join("");
    case "城市夜晚":
      return [
        "这次必须优先执行 城市夜晚 / City Pop + Electronic R&B 模板。",
        "重点保住 synth bass、analog synth、clean guitar、electronic drums 这种夜行质感。",
        "必须像地铁、霓虹、车窗反光里的内心旁白，不要 ballad，不要 dramatic singing。",
      ].join("");
    default:
      return [
        "这次必须优先执行 下班治愈 / Evening R&B 模板。",
        "重点保住 warm intimate R&B、neo soul、lo-fi、electric piano、soft bass、light drums 的陪伴感。",
        "不要为了追求副歌记忆点而做成大歌，宁可更近、更轻，也不要更炸。",
      ].join("");
  }
}

function buildStyleSpecificNegativeTags(request: GenerateAotdSongParams): string {
  const primary = resolvePrimaryStyleProfile(request);
  const baseTags = [
    "heavy metal",
    "aggressive rap",
    "noisy edm",
    "distorted screaming",
    "belting vocal",
    "shouting vocal",
    "explosive chorus",
    "stadium chorus",
    "anthemic chorus",
    "motivational pop",
    "punchy festival drums",
    "triumphant climax",
  ];
  const styleSpecificTags =
    primary.label === "快乐奖励"
      ? ["emotional ballad", "dramatic vocals", "slow piano ballad", "adult contemporary power pop"]
      : primary.label === "深夜独处"
        ? ["pop chorus", "female diva vocal", "festival pop", "k-pop bright hook", "funk pop bounce"]
        : primary.label === "重新充电"
          ? ["stadium anthem", "sports commercial uplift", "arena rock", "victory chorus"]
          : primary.label === "城市夜晚"
            ? ["power ballad", "high pitch vocal", "dramatic singing", "orchestral pop"]
            : ["powerful vocals", "dramatic chorus", "80s pop style", "big orchestra"];
  return baseTags.concat(styleSpecificTags).join(", ");
}

function buildStyleSpecificWeightConfig(request: GenerateAotdSongParams, previewCount: number): {
  styleWeight: number;
  audioWeight: number;
  weirdnessConstraint: number;
} {
  const primary = resolvePrimaryStyleProfile(request);
  switch (primary.label) {
    case "快乐奖励":
      return {
        styleWeight: previewCount >= 4 ? 0.9 : 0.86,
        audioWeight: previewCount >= 4 ? 0.72 : 0.66,
        weirdnessConstraint: 0.14,
      };
    case "深夜独处":
      return {
        styleWeight: previewCount >= 4 ? 0.88 : 0.82,
        audioWeight: previewCount >= 4 ? 0.68 : 0.62,
        weirdnessConstraint: 0.12,
      };
    case "重新充电":
      return {
        styleWeight: previewCount >= 4 ? 0.84 : 0.8,
        audioWeight: previewCount >= 4 ? 0.7 : 0.64,
        weirdnessConstraint: 0.14,
      };
    case "城市夜晚":
      return {
        styleWeight: previewCount >= 4 ? 0.86 : 0.82,
        audioWeight: previewCount >= 4 ? 0.72 : 0.68,
        weirdnessConstraint: 0.16,
      };
    default:
      return {
        styleWeight: previewCount >= 4 ? 0.84 : 0.8,
        audioWeight: previewCount >= 4 ? 0.74 : 0.68,
        weirdnessConstraint: 0.14,
      };
  }
}

function buildStyleBlendInstruction(request: GenerateAotdSongParams): string {
  const personas = inferStylePersonas(request);
  const [primary, secondary] = personas;
  if (primary && secondary) {
    return `主风格严格锁定为 ${primary.styleName}（${primary.label}），辅风格最多只允许借一点 ${secondary.styleName}（${secondary.label}）的环境感，比例不要超过 5%-10%。`;
  }
  if (primary) {
    return `主风格严格锁定为 ${primary.styleName}（${primary.label}），并与参考歌单的气质自然融合。`;
  }
  return "风格要从参考歌单里长出来，但不要同质化成普通抒情流行。";
}

function buildArrangementBlueprint(request: GenerateAotdSongParams): string {
  const personas = inferStylePersonas(request);
  return personas
    .map((persona, index) =>
      [
        `${index === 0 ? "主编曲蓝图" : "辅编曲蓝图（仅可轻微借用）"}：${persona.label} / ${persona.styleName}`,
        `BPM ${persona.bpmRange}`,
        `律动 ${persona.groove}`,
        `主乐器 ${persona.coreInstruments.join(" / ")}`,
        `鼓组 ${persona.drumHint}`,
        `和声密度 ${persona.harmonyDensity}`,
        `低频走向 ${persona.bassMotion}`,
        `混音气质 ${persona.mixMood}`,
      ].join("，"),
    )
    .join("。");
}

function buildArrangementStyleTokens(request: GenerateAotdSongParams): string {
  const primary = resolvePrimaryStyleProfile(request);
  return [
    primary.bpmRange,
    primary.groove,
    primary.coreInstruments.join(", "),
    primary.harmonyDensity,
    primary.bassMotion,
    primary.mixMood,
  ]
    .filter(Boolean)
    .join(", ");
}

function renderLyricTemplate(lines: string[], tokens: Record<string, string>): string[] {
  return lines.map((line) =>
    line.replace(/\{(\w+)\}/g, (_, key) => {
      const value = tokens[key];
      return value !== undefined && value !== null && value !== "" ? value : "";
    }),
  );
}

function buildTitleSemanticProfile(titleText: string): {
  originalTitle: string;
  action: string;
  stateShift: string;
  factualImage: string;
  hookSummary: string;
} {
  const title = String(titleText || "").trim() || "今晚先抱抱自己";
  const compact = title.replace(/\s+/g, "");
  const profile = {
    originalTitle: title,
    action: "把今晚的情绪慢慢安放好",
    stateShift: "让紧绷的心慢慢松开一点",
    factualImage: "晚风里终于能把呼吸放稳",
    hookSummary: "把标题写成今晚真实发生的情绪变化，而不是直接朗读标题",
  };

  if (/抱抱|抱住|拥抱/.test(compact)) {
    return {
      originalTitle: title,
      action: /自己|我自己/.test(compact) ? "把自己轻轻抱住一下" : "把心里那块软的地方抱紧一点",
      stateShift: "从硬撑慢慢走向被接住和被安稳托住",
      factualImage: "路灯下终于肯把肩膀放松一点，让呼吸贴回身体里",
      hookSummary: "把“抱抱”写成夜里终于愿意照顾自己、接住自己的事实",
    };
  }
  if (/放轻|轻一点|轻轻/.test(compact)) {
    return {
      originalTitle: title,
      action: "把心口、步伐和语气都放轻一点",
      stateShift: "从沉重和绷紧慢慢走向轻盈和松动",
      factualImage: "走在夜路上，脚步和呼吸终于不再那么重",
      hookSummary: "把“放轻”写成身体和情绪正在变轻的事实，不要直接念口号",
    };
  }
  if (/走回|回到|找回/.test(compact)) {
    return {
      originalTitle: title,
      action: "一步步走回自己的节奏和身体里",
      stateShift: "从失焦、漂浮慢慢走向重新对齐自己",
      factualImage: "经过几个路口以后，终于又听见自己心里的声音",
      hookSummary: "把“走回自己”写成具体路程和回归感，而不是概念化表达",
    };
  }
  if (/说完|说出口|讲完/.test(compact)) {
    return {
      originalTitle: title,
      action: "把卡在心里的话慢慢说出来",
      stateShift: "从憋着和忍着慢慢走向出口被打开",
      factualImage: "夜风经过嘴边时，那些没说完的话终于肯落地",
      hookSummary: "把“说完”写成情绪出口被打开的瞬间，不要只复述标题",
    };
  }
  if (/晚风|风/.test(compact)) {
    return {
      originalTitle: title,
      action: "让风把白天剩下的疲惫吹散一点",
      stateShift: "从闷住慢慢走向透气和回暖",
      factualImage: "风穿过街口和袖口时，心口也跟着松了一点",
      hookSummary: "把标题写成风吹过之后身体和心情的真实反应",
    };
  }
  if (/等雨|下雨|雨夜|雨/.test(compact)) {
    return {
      originalTitle: title,
      action: "在雨声里把情绪慢慢沉下来",
      stateShift: "从嘈杂慢慢走向安静和清晰",
      factualImage: "窗外雨点落下来以后，脑子里的噪音也一点点变小",
      hookSummary: "把标题写成雨夜里的观察和情绪沉降，不要像诗歌标题朗读",
    };
  }
  if (/发亮|发光|亮起来/.test(compact)) {
    return {
      originalTitle: title,
      action: "把自己一点点重新点亮",
      stateShift: "从灰掉和低落慢慢走向有光和提气",
      factualImage: "走到霓虹底下的时候，眼睛和心情都重新有了光",
      hookSummary: "把“亮起来”写成重新有力、有光的事实状态",
    };
  }
  return profile;
}

function buildLyricPersonaBlueprint(request: GenerateAotdSongParams): string {
  const [primary, secondary] = inferStylePersonas(request);
  const lines: string[] = [];
  if (primary) {
    lines.push(
      `主歌词人格：${primary.label}。叙述视角：${primary.lyricPointOfView}。句式节奏：${primary.lyricSentenceRhythm}。副歌写法：${primary.hookPattern}。`,
      `优先意象词：${primary.imageryLexicon.join(" / ")}。避免：${primary.forbiddenLyricMoves.join(" / ")}。`,
    );
  }
  if (secondary) {
    lines.push(`辅歌词人格：${secondary.label}，可少量借用这些意象：${secondary.imageryLexicon.slice(0, 4).join(" / ")}。`);
  }
  return lines.join("");
}

function buildAnswerNarrative(request: GenerateAotdSongParams): string {
  const answers = request.answers;
  if (!answers) {
    return "歌词和情绪推进要有明确的下班后治愈感，不要只是抽象抒情。";
  }
  return `用户今天被“${answers.consumptionSource}”消耗，真正想靠近的是“${answers.emotionalNeed}”，并希望把自己放进“${answers.emotionalImagery}”这幅夜晚画面里。`;
}

function buildLyricWritingGuide(request: GenerateAotdSongParams): string {
  const personas = inferStylePersonas(request);
  const personaLyricHint = personas.map((item) => item.lyricHint).join(" ");
  const personaBlueprint = buildLyricPersonaBlueprint(request);
  const answers = request.answers;
  const titleSemantic = buildTitleSemanticProfile(request.titleText);
  const titleGuide =
    `标题“${request.titleText}”是情绪命题，不是要被逐字朗读的台词。副歌里标题最多出现一次，更多时候要把它扩写成具体的事实描述、场景动作和情绪变化。` +
    `例如这次标题更适合被写成：动作“${titleSemantic.action}”，变化“${titleSemantic.stateShift}”，画面“${titleSemantic.factualImage}”。` +
    `副歌核心请优先遵循这个拆解总结：${titleSemantic.hookSummary}。`;
  if (!answers) {
    return `歌词不要像系统文案，要写具体动作、灯光、呼吸、脚步和城市空气。${titleGuide}${personaLyricHint}${personaBlueprint}`;
  }
  return [
    `歌词要把“${answers.consumptionSource} / ${answers.emotionalNeed} / ${answers.emotionalImagery}”翻译成生活化场景，不要生硬复述问卷字段。`,
    titleGuide,
    "Verse 1 写白天的消耗感和身体状态，Pre-Chorus 写转向，Hook 写标题和真正想靠近的情绪，Verse 2 写夜晚场景里的缓慢变化。",
    "多写下班路上的轻松治愈感：晚风、路灯、车窗、步伐、街角店铺、耳机里的呼吸感。",
    personaLyricHint,
    personaBlueprint,
  ].join("");
}

function buildGenerationPrompt(request: GenerateAotdSongParams): string {
  const trackLine = buildReferenceTrackLine(request);
  const styleSignature = buildReferenceStyleSignature(request);
  return [
    `请围绕“${request.titleText}”创作一首属于用户的 AOTD 歌曲。`,
    `整体气质参考今晚歌单：${trackLine || request.playlistTitle}。`,
    buildAnswerNarrative(request),
    buildStyleBlendInstruction(request),
    buildPrimaryStyleExecutionGuide(request),
    buildArrangementBlueprint(request),
    `风格签名：${styleSignature}。`,
    `人声设定：${buildVocalDirectionLine(request)}`,
    buildAfterWorkSoftnessGuide(request),
    "旋律骨架优先贴近这 5 首参考歌共同的走向和情绪推进，像同一个歌单宇宙里自然长出来的新歌。",
    "要求有真实人声、旋律完整、情绪陪伴感强，适合夜晚下班路上或回家后独处收听。",
    "整体编曲要近场、克制、现代，不要恢弘，不要大编制，不要做成八九十年代复古 power ballad，也不要把所有歌都做成同一种温柔流行底板。",
    "不要一开口就是高潮副歌，主歌、hook、过门之间要自然递进，更多口语感和连续旋律线。",
    buildLyricWritingGuide(request),
    buildLyricLanguageLine(request),
  ].join("");
}

function buildUploadLyrics(request: GenerateAotdSongParams, previewCount = 0): string {
  const hook = request.titleText.trim() || "今晚先抱抱自己";
  const moodLine = buildReferenceMoodLine(request);
  const vocalConfig = getVocalProfileConfig(request);
  const answers = request.answers;
  const personas = inferStylePersonas(request);
  const primaryPersona = personas[0];
  const titleSemantic = buildTitleSemanticProfile(hook);
  const personaLine = primaryPersona ? `${primaryPersona.label} / ${primaryPersona.styleName}` : "late-night healing";
  const tokens = {
    title: hook,
    source: answers?.consumptionSource || "白天的消耗",
    need: answers?.emotionalNeed || "把今天慢慢放下",
    scene: answers?.emotionalImagery || "夜色",
    titleAction: titleSemantic.action,
    titleStateShift: titleSemantic.stateShift,
    titleFactualImage: titleSemantic.factualImage,
  };
  const verseLines = primaryPersona
    ? renderLyricTemplate(primaryPersona.verseTemplate, tokens)
    : [
        `今天被${tokens.source}推着走了太久`,
        `想把自己放进${tokens.scene}的空气里`,
        `我想慢慢靠近${tokens.need}`,
      ];
  const preChorusLines = primaryPersona
    ? renderLyricTemplate(primaryPersona.preChorusTemplate, tokens)
    : [moodLine || "把肩膀慢慢放松一点", "不是要立刻变好 只是想先把呼吸找回来"];
  const hookLines = primaryPersona
    ? renderLyricTemplate(primaryPersona.hookTemplate, tokens)
    : [
        `${hook}`,
        answers?.consumptionSource && answers?.emotionalNeed
          ? `让我从${answers.consumptionSource}慢慢走向${answers.emotionalNeed}`
          : "把情绪轻轻放下",
        answers?.emotionalImagery ? `让${answers.emotionalImagery}陪我把今晚唱完` : "让今晚慢慢靠近一点",
      ];
  return [
    "[Verse]",
    ...verseLines,
    vocalConfig.lyricLine,
    buildAfterWorkSoftnessGuide(request),
    buildPrimaryStyleExecutionGuide(request),
    "",
    "[Pre-Chorus]",
    ...preChorusLines,
    moodLine ? `参考歌单情绪底色：${moodLine}` : "参考歌单要保留夜晚陪伴感",
    "",
    "[Hook]",
    `标题“${hook}”只点到一次或完全不直念，要把它写成情绪正在发生的事实`,
    `标题拆解：动作=${titleSemantic.action}；变化=${titleSemantic.stateShift}；画面=${titleSemantic.factualImage}`,
    `副歌优先原则：${titleSemantic.hookSummary}`,
    ...hookLines,
    `如果需要补一句，请把副歌落到“${titleSemantic.action}”这个动作上`,
    `再把情绪变化唱成“${titleSemantic.stateShift}”`,
    `并用“${titleSemantic.factualImage}”这样的事实画面来收住`,
    "",
    "[Verse 2]",
    previewCount > 0 ? `旋律贴近参考歌单，但主风格靠近 ${personaLine}` : `旋律要有记忆点，主风格靠近 ${personaLine}`,
    primaryPersona ? `优先使用这些意象词：${primaryPersona.imageryLexicon.join(" / ")}` : "多写夜晚、呼吸、步伐和街景",
    primaryPersona ? `避免这些写法：${primaryPersona.forbiddenLyricMoves.join(" / ")}` : "不要写成大合唱，不要做成复古怀旧金曲感",
  ].join("\n");
}

function buildReferenceTrackLine(request: GenerateAotdSongParams): string {
  return request.tracks
    .slice(0, 5)
    .map((track) => [track.title, track.artist].filter(Boolean).join(" - "))
    .filter(Boolean)
    .join("；");
}

function normalizeStyleSegment(value: string): string {
  return String(value || "")
    .replace(/[，；]/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUNO_STYLE_SEGMENT_LENGTH)
    .replace(/[\s,]+$/g, "");
}

function buildBoundedStyle(parts: string[]): string {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const rawPart of parts) {
    const part = normalizeStyleSegment(rawPart);
    if (!part) {
      continue;
    }
    const dedupeKey = part.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    const current = selected.join(", ");
    const nextValue = current ? `${current}, ${part}` : part;
    if (nextValue.length <= MAX_SUNO_STYLE_LENGTH) {
      selected.push(part);
      seen.add(dedupeKey);
      continue;
    }
    const remaining = MAX_SUNO_STYLE_LENGTH - (current ? current.length + 2 : 0);
    if (remaining >= 24) {
      const clipped = part.slice(0, remaining).replace(/[\s,]+$/g, "");
      if (clipped) {
        selected.push(clipped);
      }
    }
    break;
  }
  return selected.join(", ");
}

function pickTopValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return;
    }
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([value]) => value);
}

function buildReferenceMoodLine(request: GenerateAotdSongParams): string {
  const moods = pickTopValues(request.tracks.flatMap((track) => track.moods || []), 3);
  const scenes = pickTopValues(request.tracks.flatMap((track) => track.scenes || []), 2);
  return [moods.join(" / "), scenes.join(" / ")].filter(Boolean).join("，");
}

function buildReferenceStyleSignature(request: GenerateAotdSongParams): string {
  const vocalConfig = getVocalProfileConfig(request);
  const primary = resolvePrimaryStyleProfile(request);
  const genres = pickTopValues(request.tracks.map((track) => track.genre || ""), 2);
  const moods = pickTopValues(request.tracks.flatMap((track) => track.moods || []), 4);
  const scenes = pickTopValues(request.tracks.flatMap((track) => track.scenes || []), 2);
  const tags = pickTopValues(request.tracks.flatMap((track) => track.tags || []), 4);
  const languages = pickTopValues(request.tracks.map((track) => track.language || ""), 2);
  const energyCount = request.tracks.reduce(
    (acc, track) => {
      if (track.energy === "low" || track.energy === "medium" || track.energy === "high") {
        acc[track.energy] += 1;
      }
      return acc;
    },
    { low: 0, medium: 0, high: 0 },
  );
  const energyDescriptor =
    energyCount.high >= 3
      ? "softened adaptation of energetic references, low-to-mid energy, intimate not explosive"
      : energyCount.low >= 3
        ? "soft close-mic low-energy flow"
        : "mid-tempo restrained flow";
  return [
    request.vocalProfile === "foreign" ? "global pop vocal" : languages.includes("中文") ? "Mandarin vocal pop" : "vocal pop",
    primary.styleName,
    primary.styleTags,
    buildArrangementStyleTokens(request),
    genres.join(", "),
    moods.join(", "),
    scenes.join(", "),
    tags.join(", "),
    energyDescriptor,
    vocalConfig.styleTag,
    buildAfterWorkStyleTokens(request),
    "modern intimate production",
    "restrained arrangement",
    "cohesive melodic hooks",
  ]
    .filter(Boolean)
    .join(", ");
}

function buildUploadStyle(request: GenerateAotdSongParams): string {
  const trackLine = buildReferenceTrackLine(request);
  const primary = resolvePrimaryStyleProfile(request);
  return buildBoundedStyle([
    `${primary.styleName}(${primary.label})`,
    primary.productionHint,
    buildArrangementStyleTokens(request),
    buildReferenceStyleSignature(request),
    buildAfterWorkStyleTokens(request),
    getVocalProfileConfig(request).styleTag,
    trackLine || request.playlistTitle || "playlist-inspired",
  ]);
}

function isUsablePublicOrigin(origin: string): boolean {
  try {
    const targetUrl = new URL(origin);
    const hostname = targetUrl.hostname.toLowerCase();
    if (!/^https?:$/i.test(targetUrl.protocol)) {
      return false;
    }
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "example.com") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolvePublicBaseUrl(env: ReturnType<typeof loadEnv>): string {
  if (env.aotdPublicBaseUrl) {
    return isUsablePublicOrigin(env.aotdPublicBaseUrl) ? normalizeBaseUrl(env.aotdPublicBaseUrl) : "";
  }
  if (env.aotdSongCallbackUrl) {
    try {
      const callbackUrl = new URL(env.aotdSongCallbackUrl);
      return isUsablePublicOrigin(callbackUrl.origin) ? normalizeBaseUrl(callbackUrl.origin) : "";
    } catch {
      return "";
    }
  }
  return "";
}

async function persistVoiceSample(
  request: GenerateAotdSongParams,
  env: ReturnType<typeof loadEnv>,
): Promise<{ publicUrl: string; publicPath: string } | null> {
  if (!request.voiceBase64) {
    return null;
  }
  let uploadedUrl = "";
  if (env.aotdSongApiKey && env.aotdSongFileUploadBaseUrl) {
    try {
      const uploaded = await uploadBase64FileToSuno({
        apiKey: env.aotdSongApiKey,
        fileBase64: request.voiceBase64,
        fileFormat: request.voiceFormat || "mp3",
        uploadPath: "aotd-song/voice-samples",
        fileNamePrefix: request.titleText || "aotd-voice",
      });
      uploadedUrl = uploaded.downloadUrl;
    } catch (error) {
      console.warn("[aotd-song] suno song voice upload failed, fallback to project public url", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const voiceFormat = sanitizeName(request.voiceFormat || "mp3") || "mp3";
  const relativePath = buildLocalVoiceSamplePath({
    titleText: request.titleText,
    playlistTitle: request.playlistTitle,
    voiceBase64: request.voiceBase64,
    voiceFormat,
  });
  const fileName = path.basename(relativePath);
  const targetPath = path.join(generatedAudioRoot, "voice-samples", fileName);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, Buffer.from(request.voiceBase64, "base64"));
  if (uploadedUrl) {
    return {
      publicPath: relativePath,
      publicUrl: uploadedUrl,
    };
  }
  const fallbackFile = await persistBase64FileToProject({
    fileBase64: request.voiceBase64,
    fileFormat: request.voiceFormat || "mp3",
    targetSubDir: "voice-samples",
    fileNamePrefix: request.titleText || "aotd-voice",
  });
  if (!fallbackFile) {
    return null;
  }

  return {
    publicPath: fallbackFile.publicPath,
    publicUrl: fallbackFile.publicUrl,
  };
}

function buildUploadCoverRequest(
  request: GenerateAotdSongParams,
  env: ReturnType<typeof loadEnv>,
  voiceUpload: { publicUrl: string },
  previewCount: number,
): Record<string, unknown> {
  const vocalConfig = getVocalProfileConfig(request);
  const personaId = (request.voicePersonaId || env.aotdSongVoicePersonaId).trim();
  const personaModel = request.voicePersonaId ? "voice_persona" : env.aotdSongVoicePersonaModel.trim();
  const needsVoicePersonaModel = personaModel === "voice_persona";
  const model = needsVoicePersonaModel ? "V5_5" : resolveDurationCapableModel(env.aotdSongModel);
  const weightConfig = buildStyleSpecificWeightConfig(request, previewCount);
  const payload: Record<string, unknown> = {
    uploadUrl: voiceUpload.publicUrl,
    customMode: true,
    instrumental: false,
    model,
    callBackUrl: buildCallbackUrl(request, env),
    prompt: buildUploadLyrics(request, previewCount),
    style: buildUploadStyle(request),
    title: request.titleText || "我的 AOTD 小歌",
    negativeTags: buildStyleSpecificNegativeTags(request),
    styleWeight: Math.max(weightConfig.styleWeight, 0.84),
    weirdnessConstraint: Math.max(weightConfig.weirdnessConstraint, 0.18),
    audioWeight: Math.max(weightConfig.audioWeight, 0.84),
    duration: TARGET_AOTD_SONG_DURATION_SECONDS,
  };
  if (vocalConfig.vocalGender) {
    payload.vocalGender = vocalConfig.vocalGender;
  }
  if (personaId) {
    payload.personaId = personaId;
    payload.personaModel = personaModel || "style_persona";
  }
  return payload;
}

function buildTextGenerationRequest(
  request: GenerateAotdSongParams,
  env: ReturnType<typeof loadEnv>,
  previewCount: number,
): Record<string, unknown> {
  const vocalConfig = getVocalProfileConfig(request);
  const voicePersonaId = (request.voicePersonaId || env.aotdSongVoicePersonaId).trim();
  const weightConfig = buildStyleSpecificWeightConfig(request, previewCount);
  if (!voicePersonaId) {
    const model = resolveDurationCapableModel(env.aotdSongModel);
    const basePayload: Record<string, unknown> = {
      customMode: true,
      instrumental: false,
      model,
      callBackUrl: buildCallbackUrl(request, env),
      prompt: buildGenerationPrompt(request),
      style: buildUploadStyle(request),
      title: request.titleText || "我的 AOTD 小歌",
      negativeTags: `${buildStyleSpecificNegativeTags(request)}, childish melody, 80s retro synth, 90s karaoke pop, power ballad, overture intro`,
      styleWeight: weightConfig.styleWeight,
      weirdnessConstraint: weightConfig.weirdnessConstraint,
      audioWeight: weightConfig.audioWeight,
      duration: TARGET_AOTD_SONG_DURATION_SECONDS,
    };
    if (vocalConfig.vocalGender) {
      return Object.assign(basePayload, {
        vocalGender: vocalConfig.vocalGender,
      });
    }
    return basePayload;
  }
  const voicePayload: Record<string, unknown> = {
    customMode: true,
    instrumental: false,
    model: "V5_5",
    callBackUrl: buildCallbackUrl(request, env),
    prompt: buildUploadLyrics(request, previewCount),
    style: buildUploadStyle(request),
    title: request.titleText || "我的 AOTD 小歌",
    personaId: voicePersonaId,
    personaModel: "voice_persona",
    negativeTags: buildStyleSpecificNegativeTags(request),
    styleWeight: Math.max(weightConfig.styleWeight, 0.84),
    weirdnessConstraint: Math.max(weightConfig.weirdnessConstraint, 0.18),
    audioWeight: Math.max(weightConfig.audioWeight, 0.84),
    duration: TARGET_AOTD_SONG_DURATION_SECONDS,
  };
  if (vocalConfig.vocalGender) {
    voicePayload.vocalGender = vocalConfig.vocalGender;
  }
  return voicePayload;
}

function buildRequestSnippet(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  return text.length > limit ? `${text.slice(0, limit)}...(truncated)` : text;
}

function logSunoCreateRequest(
  flow: "upload-cover" | "text-generate",
  url: string,
  request: GenerateAotdSongParams,
  payload: Record<string, unknown>,
): void {
  const styleHit = resolveAotdSongStyleHit(request);
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const style = typeof payload.style === "string" ? payload.style : "";
  console.log("[aotd-song] suno create request", {
    flow,
    url,
    titleText: request.titleText,
    playlistTitle: request.playlistTitle,
    vocalProfile: request.vocalProfile || "female",
    styleHit,
    model: payload.model,
    styleWeight: payload.styleWeight,
    audioWeight: payload.audioWeight,
    weirdnessConstraint: payload.weirdnessConstraint,
    negativeTags: buildRequestSnippet(payload.negativeTags, 500),
    styleLength: style.length,
    stylePreview: buildRequestSnippet(style, 700),
    promptPreview: buildRequestSnippet(prompt, 1200),
    promptHash: crypto.createHash("sha1").update(prompt).digest("hex"),
    styleHash: crypto.createHash("sha1").update(style).digest("hex"),
  });
}

function extractTaskId(payload: RemoteSongResponse): string {
  return payload.taskId || payload.id || payload.data?.taskId || "";
}

export function extractRemoteSongStatus(payload: unknown): string {
  const record = payload as RemoteSongResponse;
  return String(
    record?.status ||
      record?.data?.status ||
      ("callbackType" in (record?.data || {}) ? (record?.data as { callbackType?: string }).callbackType : "") ||
      ("callbackType" in record ? (record as { callbackType?: string }).callbackType : ""),
  ).toUpperCase();
}

function extractStatus(payload: RemoteSongResponse): string {
  return extractRemoteSongStatus(payload);
}

function normalizeGeneratedSong(
  payload: RemoteSongResponse,
  request: GenerateAotdSongParams,
): GeneratedAotdSong | null {
  const rawTrack =
    payload.data?.data?.[0] ||
    (Array.isArray(payload.data?.response?.data) ? payload.data?.response?.data?.[0] : undefined) ||
    (Array.isArray(payload.data?.response?.sunoData) ? payload.data?.response?.sunoData?.[0] : undefined);
  const track: NormalizedRemoteTrack | null = rawTrack
    ? {
        audioUrl:
          rawTrack.audioUrl ||
          ("audio_url" in rawTrack ? rawTrack.audio_url || "" : "") ||
          ("streamAudioUrl" in rawTrack ? rawTrack.streamAudioUrl || "" : "") ||
          ("sourceStreamAudioUrl" in rawTrack ? rawTrack.sourceStreamAudioUrl || "" : "") ||
          ("source_audio_url" in rawTrack ? rawTrack.source_audio_url || "" : ""),
        title: rawTrack.title,
        tags: rawTrack.tags,
        duration:
          ("durationSeconds" in rawTrack ? rawTrack.durationSeconds || 0 : 0) ||
          ("duration" in rawTrack ? Number(rawTrack.duration || 0) : 0),
      }
    : null;
  const audioUrl =
    payload.audioUrl ||
    payload.audio_url ||
    payload.source_audio_url ||
    track?.audioUrl ||
    "";
  if (!audioUrl) {
    return null;
  }
  return {
    title: payload.title || track?.title || request.titleText || "我的 AOTD 小歌",
    summary:
      payload.summary ||
      `已根据“${request.titleText}”与今晚歌单生成专属歌曲${track?.tags ? `，风格标签：${track.tags}` : ""}。`,
    durationSeconds: Number(payload.durationSeconds || payload.duration_seconds || track?.duration || 0) || 0,
    audioPath: audioUrl,
    voiceSamplePath: payload.voiceSampleUrl || payload.voice_sample_url || undefined,
    mode: "real",
    provider: "remote",
  };
}

export async function resolveGeneratedSongFromRemotePayload(
  payload: unknown,
  params: {
    titleText: string;
    playlistTitle: string;
    voiceSamplePath?: string;
  },
): Promise<GeneratedAotdSong | null> {
  const requestSeed: GenerateAotdSongParams = {
    titleText: params.titleText,
    playlistTitle: params.playlistTitle,
    tracks: [],
    voiceBase64: "",
    voiceFormat: "mp3",
  };
  const song = normalizeGeneratedSong(payload as RemoteSongResponse, requestSeed);
  if (!song) {
    return null;
  }
  try {
    song.audioPath = await cacheRemoteAudioToLocal({
      remoteUrl: song.audioPath,
      targetSubDir: "remote-audio",
      fileNamePrefix: song.title || params.titleText || "aotd-song",
    });
  } catch (error) {
    console.warn("[aotd-song] failed to cache remote audio, keep original url", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (params.voiceSamplePath && !song.voiceSamplePath) {
    song.voiceSamplePath = params.voiceSamplePath;
  }
  return song;
}

async function postJson(url: string, apiKey: string, body: object): Promise<RemoteSongResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as RemoteSongResponse;
  if (!response.ok || payload.code === 400 || payload.code === 401 || payload.code === 404 || payload.code === 405 || payload.code === 413 || payload.code === 429 || payload.code === 430 || payload.code === 455 || payload.code === 500) {
    throw new Error(extractErrorMessage(payload, `AOTD song provider create failed: ${response.status}`));
  }
  return payload;
}

async function getJson(url: string, apiKey: string): Promise<RemoteSongResponse> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as RemoteSongResponse;
  if (!response.ok || payload.code === 400 || payload.code === 401 || payload.code === 404 || payload.code === 405 || payload.code === 413 || payload.code === 429 || payload.code === 430 || payload.code === 455 || payload.code === 500) {
    throw new Error(extractErrorMessage(payload, `AOTD song provider status failed: ${response.status}`));
  }
  return payload;
}

async function getJsonWithRetry(url: string, apiKey: string): Promise<RemoteSongResponse> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < STATUS_FETCH_RETRY_LIMIT; attempt += 1) {
    try {
      return await getJson(url, apiKey);
    } catch (error) {
      lastError = error;
      if (!isRetryableFetchError(error) || attempt === STATUS_FETCH_RETRY_LIMIT - 1) {
        throw error;
      }
      await sleep(STATUS_FETCH_RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("真实音乐服务状态查询失败");
}

export function isRealAotdSongProviderConfigured(): boolean {
  const env = loadEnv();
  return env.aotdSongProvider === "remote" && Boolean(env.aotdSongApiKey && env.aotdSongBaseUrl);
}

export async function generateAotdSongViaRemoteProvider(
  params: GenerateAotdSongParams,
): Promise<GeneratedAotdSong> {
  const env = loadEnv();
  if (!env.aotdSongApiKey || !env.aotdSongBaseUrl) {
    throw new Error("AOTD_SONG_API_KEY 或 AOTD_SONG_BASE_URL 未配置");
  }

  const baseUrl = normalizeBaseUrl(env.aotdSongBaseUrl);
  const [voiceUpload, referencePreviews] = await Promise.all([
    persistVoiceSample(params, env),
    cacheNeteaseTrackPreviews(
      params.tracks.map((track) => ({
        title: track.title,
        artist: track.artist,
        originalId: track.originalId,
      })),
    ),
  ]);
  const cachedPreviewCount = referencePreviews.filter((item) => item.cached && item.audioPath).length;

  let createPayload: RemoteSongResponse;
  try {
    if (voiceUpload) {
      const uploadCreateUrl = `${baseUrl}${normalizePath(env.aotdSongUploadCreatePath)}`;
      const uploadRequestBody = buildUploadCoverRequest(params, env, voiceUpload, cachedPreviewCount);
      logSunoCreateRequest("upload-cover", uploadCreateUrl, params, uploadRequestBody);
      createPayload = await postJson(
        uploadCreateUrl,
        env.aotdSongApiKey,
        uploadRequestBody,
      );
    } else {
      const createUrl = `${baseUrl}${normalizePath(env.aotdSongCreatePath)}`;
      const textRequestBody = buildTextGenerationRequest(params, env, cachedPreviewCount);
      logSunoCreateRequest("text-generate", createUrl, params, textRequestBody);
      createPayload = await postJson(createUrl, env.aotdSongApiKey, textRequestBody);
    }
  } catch (error) {
    if (!voiceUpload) {
      throw error;
    }
    console.warn("[aotd-song] upload-cover flow failed, fallback to prompt generation", {
      error: error instanceof Error ? error.message : String(error),
    });
    const createUrl = `${baseUrl}${normalizePath(env.aotdSongCreatePath)}`;
    const fallbackTextRequestBody = buildTextGenerationRequest(params, env, cachedPreviewCount);
    logSunoCreateRequest("text-generate", createUrl, params, fallbackTextRequestBody);
    createPayload = await postJson(createUrl, env.aotdSongApiKey, fallbackTextRequestBody);
  }

  const directSong = normalizeGeneratedSong(createPayload, params);
  if (directSong) {
    try {
      directSong.audioPath = await cacheRemoteAudioToLocal({
        remoteUrl: directSong.audioPath,
        targetSubDir: "remote-audio",
        fileNamePrefix: directSong.title || params.titleText || "aotd-song",
      });
    } catch (error) {
      console.warn("[aotd-song] failed to cache remote audio, keep original url", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (voiceUpload) {
      directSong.voiceSamplePath = voiceUpload.publicPath;
      directSong.summary =
        cachedPreviewCount > 0
          ? `已参考 ${cachedPreviewCount} 首歌的试听与风格标签，并把你的录音接入生成链路。`
          : "已结合这次歌单的风格标签，并把你的录音接入生成链路。";
    }
    return directSong;
  }

  const taskId = extractTaskId(createPayload);
  if (!taskId) {
    throw new Error("真实音乐服务未返回 taskId 或 audioUrl");
  }

  let transientStatusErrorStreak = 0;
  for (let attempt = 0; attempt < MAX_PROVIDER_POLLS; attempt += 1) {
    await sleep(getProviderPollIntervalMs(attempt));
    const statusUrl = `${baseUrl}${normalizePath(env.aotdSongStatusPath, taskId)}`;
    let statusPayload: RemoteSongResponse;
    try {
      statusPayload = await getJsonWithRetry(statusUrl, env.aotdSongApiKey);
      transientStatusErrorStreak = 0;
    } catch (error) {
      if (isRetryableFetchError(error) && attempt < MAX_PROVIDER_POLLS - 1) {
        transientStatusErrorStreak += 1;
        console.warn("[aotd-song] transient status poll failed", {
          taskId,
          attempt: attempt + 1,
          streak: transientStatusErrorStreak,
          error: error instanceof Error ? error.message : String(error),
        });
        if (transientStatusErrorStreak < MAX_TRANSIENT_STATUS_ERROR_STREAK) {
          continue;
        }
        throw new Error("真实音乐服务状态查询连续超时");
      }
      throw error;
    }
    const status = extractStatus(statusPayload);

    const completedSong = normalizeGeneratedSong(statusPayload, params);
    if (completedSong) {
      try {
        completedSong.audioPath = await cacheRemoteAudioToLocal({
          remoteUrl: completedSong.audioPath,
          targetSubDir: "remote-audio",
          fileNamePrefix: completedSong.title || params.titleText || "aotd-song",
        });
      } catch (error) {
        console.warn("[aotd-song] failed to cache remote audio, keep original url", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (voiceUpload) {
        completedSong.voiceSamplePath = voiceUpload.publicPath;
        completedSong.summary =
          completedSong.summary ||
          (cachedPreviewCount > 0
            ? `已参考 ${cachedPreviewCount} 首歌的试听与风格标签，并把你的录音接入生成链路。`
            : "已结合这次歌单的风格标签，并把你的录音接入生成链路。");
      }
      return completedSong;
    }
    if (status === "FAILED" || status === "ERROR") {
      throw new Error(extractErrorMessage(statusPayload, "真实音乐服务生成失败"));
    }
  }

  throw new Error("真实音乐服务生成超时，请稍后再看结果");
}
