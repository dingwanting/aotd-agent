import {
  generateAotdSongDemo,
  type GenerateAotdSongDemoParams,
} from "./aotd-song-demo.js";
import {
  generateAotdSongViaRemoteProvider,
  isRealAotdSongProviderConfigured,
} from "./aotd-song-real-provider.js";

export interface AotdSongTrackSeed {
  title: string;
  artist: string;
}

export interface GenerateAotdSongParams {
  titleText: string;
  playlistTitle: string;
  tracks: AotdSongTrackSeed[];
  voiceBase64: string;
  voiceFormat: string;
  voicePersonaId?: string;
}

export interface GeneratedAotdSong {
  title: string;
  summary: string;
  durationSeconds: number;
  audioPath: string;
  voiceSamplePath?: string;
  provider: "demo" | "remote";
  mode: "demo" | "real";
}

export interface AotdSongProvider {
  generate(params: GenerateAotdSongParams): Promise<GeneratedAotdSong>;
}

class DemoAotdSongProvider implements AotdSongProvider {
  async generate(params: GenerateAotdSongParams): Promise<GeneratedAotdSong> {
    const result = await generateAotdSongDemo(params as GenerateAotdSongDemoParams);
    return {
      ...result,
      mode: "demo",
      provider: "demo",
    };
  }
}

class RealAotdSongProvider implements AotdSongProvider {
  async generate(params: GenerateAotdSongParams): Promise<GeneratedAotdSong> {
    return generateAotdSongViaRemoteProvider(params);
  }
}

function resolveProvider(): AotdSongProvider {
  if (isRealAotdSongProviderConfigured()) {
    return new RealAotdSongProvider();
  }
  return new DemoAotdSongProvider();
}

export function getAotdSongProviderMode(): "demo" | "remote" {
  return isRealAotdSongProviderConfigured() ? "remote" : "demo";
}

export async function generateAotdSong(params: GenerateAotdSongParams): Promise<GeneratedAotdSong> {
  return resolveProvider().generate(params);
}
