import type { MarketSnapshot } from "./kalshi";
import type { Recommendation } from "./recommendation";

export type TradeSide = "YES" | "NO";

export interface Trade {
  ticker: string;
  side: TradeSide;
  size: number;
  entryPrice: number;
  entryTime: string;
}

export interface MarketResearch {
  snapshot: MarketSnapshot;
  news: string[];
  bull_case: string;
  bear_case: string;
  base_case: string;
  key_risks: string[];
  invalidators: string[];
  p_agent: number;
  confidence: number;
  generatedAt: string;
}

export interface PostMortem {
  ticker: string;
  outcome: TradeSide;
  summary: string;
  lessons: string[];
  improvements: string[];
  generatedAt: string;
}

export interface SessionState {
  watchlist: Set<string>;
  trades: Trade[];
  lastRecommendationByTicker: Record<string, Recommendation>;
  alertDelta: number;
  researchByTicker: Record<string, MarketResearch>;
  postMortemsByTicker: Record<string, PostMortem>;
}

const sessions = new Map<string, SessionState>();

export function getSessionState(sessionId: string): SessionState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  const state: SessionState = {
    watchlist: new Set(),
    trades: [],
    lastRecommendationByTicker: {},
    alertDelta: 0.04,
    researchByTicker: {},
    postMortemsByTicker: {}
  };

  sessions.set(sessionId, state);
  return state;
}
