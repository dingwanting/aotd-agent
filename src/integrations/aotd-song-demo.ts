import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const generatedRoot = path.join(projectRoot, "web", "generated", "aotd-song");
const SAMPLE_RATE = 22050;
const DURATION_SECONDS = 24;

interface SongSeedTrack {
  title: string;
  artist: string;
}

export interface GenerateAotdSongDemoParams {
  titleText: string;
  playlistTitle: string;
  tracks: SongSeedTrack[];
  voiceBase64?: string;
  voiceFormat?: string;
}

export interface GenerateAotdSongDemoResult {
  title: string;
  summary: string;
  durationSeconds: number;
  audioPath: string;
  voiceSamplePath?: string;
  mode: "demo";
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function sanitizeName(value: string): string {
  return String(value || "aotd-song")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "aotd-song";
}

function buildIntroSummary(titleText: string, tracks: SongSeedTrack[]): string {
  const trackLine = tracks
    .slice(0, 3)
    .map((track) => [track.title, track.artist].filter(Boolean).join(" - "))
    .filter(Boolean)
    .join(" / ");
  return trackLine
    ? `已按“${titleText}”和 ${trackLine} 的气质生成一段 AOTD 小歌 demo。`
    : `已按“${titleText}”生成一段 AOTD 小歌 demo。`;
}

function createSampleBuffer(): Float32Array {
  return new Float32Array(SAMPLE_RATE * DURATION_SECONDS);
}

function addTone(
  samples: Float32Array,
  startSeconds: number,
  durationSeconds: number,
  frequency: number,
  volume: number,
  options: { harmonic?: number; tremolo?: number } = {},
) {
  const startIndex = Math.max(0, Math.floor(startSeconds * SAMPLE_RATE));
  const endIndex = Math.min(samples.length, Math.floor((startSeconds + durationSeconds) * SAMPLE_RATE));
  const attack = Math.max(1, Math.floor(SAMPLE_RATE * 0.02));
  const release = Math.max(1, Math.floor(SAMPLE_RATE * 0.08));
  const harmonic = options.harmonic ?? 0.3;
  const tremolo = options.tremolo ?? 0;

  for (let index = startIndex; index < endIndex; index += 1) {
    const progress = index - startIndex;
    const frameCount = endIndex - startIndex;
    let envelope = 1;
    if (progress < attack) {
      envelope = progress / attack;
    } else if (frameCount - progress < release) {
      envelope = Math.max(0, (frameCount - progress) / release);
    }
    const time = index / SAMPLE_RATE;
    const wave =
      Math.sin(2 * Math.PI * frequency * time) +
      harmonic * Math.sin(2 * Math.PI * frequency * 2 * time) +
      harmonic * 0.4 * Math.sin(2 * Math.PI * frequency * 0.5 * time);
    const tremoloGain = tremolo ? 0.82 + 0.18 * Math.sin(2 * Math.PI * tremolo * time) : 1;
    samples[index] += wave * volume * envelope * tremoloGain;
  }
}

function buildMelodyFrequencies(seed: string): number[] {
  const scale = [220, 246.94, 261.63, 293.66, 329.63, 369.99, 440, 493.88];
  const frequencies: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    const hash = hashString(`${seed}-${index}`);
    const note = scale[hash % scale.length] * (hash % 3 === 0 ? 0.5 : 1);
    frequencies.push(note);
  }
  return frequencies;
}

function renderDemoSong(seed: string): Float32Array {
  const samples = createSampleBuffer();
  const melody = buildMelodyFrequencies(seed);
  const bass = [110, 123.47, 130.81, 146.83];

  for (let bar = 0; bar < 8; bar += 1) {
    const barStart = bar * 3;
    const bassFrequency = bass[hashString(`${seed}-bass-${bar}`) % bass.length];
    addTone(samples, barStart, 2.8, bassFrequency, 0.09, { harmonic: 0.18, tremolo: 0.5 });
    addTone(samples, barStart + 0.2, 2.4, bassFrequency * 2, 0.04, { harmonic: 0.12, tremolo: 1.2 });

    for (let step = 0; step < 2; step += 1) {
      const melodyFrequency = melody[(bar * 2 + step) % melody.length];
      addTone(samples, barStart + step * 1.25 + 0.18, 0.9, melodyFrequency, 0.12, { harmonic: 0.24, tremolo: 5.4 });
      addTone(samples, barStart + step * 1.25 + 0.62, 0.55, melodyFrequency * 1.5, 0.06, { harmonic: 0.16, tremolo: 6.4 });
    }
  }

  for (let index = 0; index < samples.length; index += 1) {
    const fadeIn = Math.min(1, index / (SAMPLE_RATE * 1.2));
    const fadeOut = Math.min(1, (samples.length - index) / (SAMPLE_RATE * 2));
    samples[index] *= fadeIn * fadeOut;
    samples[index] = Math.max(-0.95, Math.min(0.95, samples[index]));
  }

  return samples;
}

function floatTo16BitPcm(samples: Float32Array): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    pcm.writeInt16LE(Math.round(value), index * 2);
  }
  return pcm;
}

function buildWavBuffer(samples: Float32Array): Buffer {
  const pcm = floatTo16BitPcm(samples);
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function generateAotdSongDemo(
  params: GenerateAotdSongDemoParams,
): Promise<GenerateAotdSongDemoResult> {
  await fs.mkdir(generatedRoot, { recursive: true });
  const seed = [params.titleText, params.playlistTitle, ...params.tracks.map((track) => `${track.title}-${track.artist}`)].join("|");
  const fileBase = `${Date.now()}-${sanitizeName(params.titleText || params.playlistTitle)}`;
  const wavFileName = `${fileBase}.wav`;
  const wavRelativePath = `/generated/aotd-song/${wavFileName}`;

  const audioBuffer = buildWavBuffer(renderDemoSong(seed));
  await fs.writeFile(path.join(generatedRoot, wavFileName), audioBuffer);

  let voiceSamplePath = "";
  if (params.voiceBase64) {
    const voiceFormat = sanitizeName(params.voiceFormat || "mp3") || "mp3";
    const voiceFileName = `${fileBase}-voice.${voiceFormat}`;
    await fs.writeFile(path.join(generatedRoot, voiceFileName), Buffer.from(params.voiceBase64, "base64"));
    voiceSamplePath = `/generated/aotd-song/${voiceFileName}`;
  }

  return {
    title: params.titleText || "我的 AOTD 小歌",
    summary: buildIntroSummary(params.titleText || params.playlistTitle || "今晚", params.tracks),
    durationSeconds: DURATION_SECONDS,
    audioPath: wavRelativePath,
    voiceSamplePath: voiceSamplePath || undefined,
    mode: "demo",
  };
}
