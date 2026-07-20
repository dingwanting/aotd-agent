export interface AotdQuestionnaireAnswers {
  consumptionSource: string;
  emotionalNeed: string;
  emotionalImagery: string;
}

export interface AotdRequest {
  answers: AotdQuestionnaireAnswers;
  excludeSongIds?: string[];
  excludeSongKeys?: string[];
}

export interface AotdPlan {
  consumptionSource: string;
  emotionalNeed: string;
  emotionalImagery: string;
  userIntent: string;
  todayStateSummary: string;
  moodSignals: string[];
  sceneSignals: string[];
  objectiveSignals: string[];
  constraints: string[];
  playlistStrategy: string;
  queryHints: string[];
  explanationStyle: string;
  uncertainty: string[];
}

export interface SongDocument {
  id: string;
  title: string;
  artist: string;
  language: string;
  energy: "low" | "medium" | "high";
  primaryNeed: string;
  genre: string;
  moods: string[];
  scenes: string[];
  tags: string[];
  needTags: string[];
  sceneTags: string[];
  weatherTags: string[];
  timeTags: string[];
  cliKeyword: string;
  isPlayable: boolean;
  idStatus: string;
  reviewStatus: string;
  originalId?: string;
  encryptedId?: string;
  priority?: number;
}

export interface RetrievalCandidate {
  song: SongDocument;
  score: number;
  matchedSignals: string[];
  reason: string;
  scoreBreakdown?: string[];
}

export interface PlaylistEntry {
  rank: number;
  song: SongDocument;
  reason: string;
  score: number;
}

export interface AotdAnalysis {
  todayState: string;
  hitLine: string;
  recommendationLogic: string;
}

export interface AotdPlaylist {
  title: string;
  subtitle: string;
  description: string;
  tracks: PlaylistEntry[];
}

export interface AotdShareCard {
  title: string;
  subtitle: string;
  caption: string;
  tags: string[];
}

export interface AotdResponse {
  answers: AotdQuestionnaireAnswers;
  plan: AotdPlan;
  analysis: AotdAnalysis;
  playlist: AotdPlaylist;
  candidates: RetrievalCandidate[];
  shareCard: AotdShareCard;
}
