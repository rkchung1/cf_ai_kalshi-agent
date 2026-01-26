/**
 * MarketScout tools for Kalshi market research and recommendations
 */
import { tool, type ToolSet, generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod/v3";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";

import type { Chat } from "./server";
import {
  fetchMarketSnapshot,
  fetchMarketNews,
  fetchMarketSnapshotsForEvent,
  type MarketSnapshot
} from "./lib/kalshi";
import {
  makeRecommendation,
  type Position,
  type Recommendation
} from "./lib/recommendation";
import {
  getSessionState,
  type MarketResearch,
  type PostMortem,
  type TradeSide
} from "./lib/state";

const model = openai("gpt-4o-2024-11-20");
const CHECK_WATCHLIST_PAYLOAD = JSON.stringify({ type: "checkWatchlist" });

const researchSchema = z.object({
  bull_case: z.string(),
  bear_case: z.string(),
  base_case: z.string(),
  key_risks: z.array(z.string()),
  invalidators: z.array(z.string()),
  p_agent: z.number(),
  confidence: z.number()
});

type ScheduleInput = z.infer<typeof scheduleSchema>;

type RecommendationResult = {
  recommendation: Recommendation;
  snapshot: MarketSnapshot;
  research: MarketResearch;
  pMarket: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  let normalized = value;
  if (normalized > 1.01) {
    normalized = normalized / 100;
  }
  return clamp(normalized, 0, 1);
}

function resolveSessionId(sessionId?: string): string {
  if (sessionId) return sessionId;
  const { agent, connection, request } = getCurrentAgent<Chat>();
  return (
    connection?.id ||
    agent?.name ||
    request?.headers.get("x-partykit-room") ||
    "default"
  );
}

function readEnv(key: "KALSHI_API_KEY" | "NEWS_API_KEY"): string | undefined {
  if (typeof process !== "undefined" && process.env?.[key]) {
    return process.env[key];
  }
  const { agent } = getCurrentAgent<Chat>();
  const env = (agent as unknown as { env?: Record<string, string> })?.env;
  return env?.[key];
}

function getCurrentPosition(trades: Array<{ ticker: string; side: TradeSide }>, ticker: string): Position {
  const lastTrade = [...trades].reverse().find((trade) => trade.ticker === ticker);
  return lastTrade ? lastTrade.side : "NONE";
}

function daysToResolution(resolutionDate: string): number {
  if (!resolutionDate) return 0;
  const target = new Date(resolutionDate);
  if (Number.isNaN(target.getTime())) return 0;
  const diffMs = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function parseScheduledPayload(payload: string): { type: "checkWatchlist" } | null {
  if (payload === "checkWatchlist") return { type: "checkWatchlist" };
  try {
    const parsed = JSON.parse(payload) as { type?: string };
    if (parsed?.type === "checkWatchlist") return { type: "checkWatchlist" };
  } catch {
    return null;
  }
  return null;
}

async function scheduleTaskInternal(input: ScheduleInput): Promise<string> {
  const { agent } = getCurrentAgent<Chat>();
  if (!agent) return "Unable to access agent scheduler.";

  const { when, description } = input;
  if (when.type === "no-schedule") {
    return "Not a valid schedule input";
  }

  const scheduledInput =
    when.type === "scheduled"
      ? when.date
      : when.type === "delayed"
        ? when.delayInSeconds
        : when.type === "cron"
          ? when.cron
          : undefined;

  if (!scheduledInput) {
    return "Not a valid schedule input";
  }

  try {
    agent.schedule(scheduledInput, "executeTask", description);
  } catch (error) {
    console.error("error scheduling task", error);
    return `Error scheduling task: ${error}`;
  }

  return `Task scheduled for type "${when.type}" : ${scheduledInput}`;
}

function minutesToCron(frequencyMinutes: number): {
  cron: string;
  normalizedMinutes: number;
  note?: string;
} {
  if (frequencyMinutes <= 0) {
    return { cron: "*/30 * * * *", normalizedMinutes: 30, note: "Defaulted to 30 minutes." };
  }

  if (frequencyMinutes < 60) {
    return { cron: `*/${frequencyMinutes} * * * *`, normalizedMinutes: frequencyMinutes };
  }

  if (frequencyMinutes % 60 === 0) {
    const hours = frequencyMinutes / 60;
    return { cron: `0 */${hours} * * *`, normalizedMinutes: frequencyMinutes };
  }

  const hours = Math.max(1, Math.round(frequencyMinutes / 60));
  const normalizedMinutes = hours * 60;
  return {
    cron: `0 */${hours} * * *`,
    normalizedMinutes,
    note: `Rounded to ${normalizedMinutes} minutes for cron compatibility.`
  };
}

async function runResearch(
  ticker: string,
  sessionId?: string
): Promise<MarketResearch | null> {
  const state = getSessionState(resolveSessionId(sessionId));
  const existing = state.researchByTicker[ticker];
  if (existing) return existing;

  const apiKey = readEnv("KALSHI_API_KEY");
  const snapshot = await fetchMarketSnapshot(ticker, apiKey);
  if (!snapshot) return null;

  const newsKey = readEnv("NEWS_API_KEY");
  const headlines = await fetchMarketNews(snapshot.title, newsKey);

  const prompt = `You are MarketScout, a Kalshi prediction-market research assistant.

Market snapshot:
${JSON.stringify(snapshot, null, 2)}

Recent headlines:
${headlines.length ? headlines.map((headline, index) => `${index + 1}. ${headline}`).join("\n") : "No recent headlines available."}

Provide a concise research brief.
- Use only the snapshot and headlines provided.
- bull_case, bear_case, base_case should each be 2-4 sentences.
- key_risks and invalidators should be short bullet lists.
- p_agent is your estimated probability of YES (0-1).
- confidence is 0-1.
`;

  const { object } = await generateObject({
    model,
    schema: researchSchema,
    prompt
  });

  const research: MarketResearch = {
    snapshot,
    news: headlines,
    bull_case: object.bull_case.trim(),
    bear_case: object.bear_case.trim(),
    base_case: object.base_case.trim(),
    key_risks: object.key_risks.map((risk) => risk.trim()).filter(Boolean),
    invalidators: object.invalidators
      .map((invalidator) => invalidator.trim())
      .filter(Boolean),
    p_agent: normalizeProbability(object.p_agent),
    confidence: normalizeProbability(object.confidence),
    generatedAt: new Date().toISOString()
  };

  state.researchByTicker[ticker] = research;
  return research;
}

async function getRecommendationForTicker(
  ticker: string,
  options?: { maxBet?: number; snapshotOverride?: MarketSnapshot; sessionId?: string }
): Promise<RecommendationResult | null> {
  const sessionId = resolveSessionId(options?.sessionId);
  const state = getSessionState(sessionId);

  const research = await runResearch(ticker, sessionId);
  if (!research) return null;

  const apiKey = readEnv("KALSHI_API_KEY");
  const snapshot =
    options?.snapshotOverride ??
    research.snapshot ??
    (await fetchMarketSnapshot(ticker, apiKey));

  if (!snapshot) return null;

  const pMarket = snapshot.yesPrice;
  const liquidity = 0.5;
  const days = daysToResolution(snapshot.resolutionDate);
  const currentPosition = getCurrentPosition(state.trades, ticker);
  const maxBet = options?.maxBet ?? 100;

  const recommendation = makeRecommendation(
    research.p_agent,
    pMarket,
    research.confidence,
    liquidity,
    days,
    currentPosition,
    maxBet
  );

  state.lastRecommendationByTicker[ticker] = recommendation;

  return {
    recommendation,
    snapshot,
    research,
    pMarket
  };
}

export async function runCheckWatchlist(sessionId?: string) {
  const resolvedSessionId = resolveSessionId(sessionId);
  const state = getSessionState(resolvedSessionId);

  const alerts: string[] = [];
  const checked: string[] = [];
  const errors: string[] = [];

  for (const ticker of state.watchlist) {
    const previous = state.lastRecommendationByTicker[ticker];
    const apiKey = readEnv("KALSHI_API_KEY");
    const snapshot = await fetchMarketSnapshot(ticker, apiKey);

    if (!snapshot) {
      errors.push(`${ticker}: unable to fetch latest snapshot`);
      continue;
    }

    const result = await getRecommendationForTicker(ticker, {
      snapshotOverride: snapshot,
      sessionId: resolvedSessionId
    });

    if (!result) {
      errors.push(`${ticker}: unable to compute recommendation`);
      continue;
    }

    const current = result.recommendation;
    checked.push(ticker);

    if (!previous) {
      alerts.push(
        `${ticker}: new recommendation ${current.action} (edge ${current.edge.toFixed(3)})`
      );
      continue;
    }

    const edgeDelta = Math.abs(current.edge - previous.edge);
    if (previous.action !== current.action || edgeDelta >= state.alertDelta) {
      alerts.push(
        `${ticker}: ${previous.action} -> ${current.action} (edge ${previous.edge.toFixed(3)} -> ${current.edge.toFixed(3)})`
      );
    }
  }

  return {
    checkedCount: checked.length,
    alerts,
    errors
  };
}

const analyzeMarket = tool({
  description: "Fetch a Kalshi market snapshot by ticker or URL",
  inputSchema: z.object({
    tickerOrUrl: z.string(),
    allOutcomes: z.boolean().optional()
  }),
  execute: async ({ tickerOrUrl, allOutcomes }) => {
    const apiKey = readEnv("KALSHI_API_KEY");
    const isLikelyMarketUrl =
      /^https?:\/\//i.test(tickerOrUrl) &&
      /kalshi\.com\/markets\//i.test(tickerOrUrl);

    if (allOutcomes || isLikelyMarketUrl) {
      const result = await fetchMarketSnapshotsForEvent(tickerOrUrl, apiKey);
      if (result && result.markets.length > 1) {
        return result;
      }
      if (allOutcomes && (!result || result.markets.length === 0)) {
        return { error: "Market not found or unavailable." };
      }
    }

    const snapshot = await fetchMarketSnapshot(tickerOrUrl, apiKey);
    if (!snapshot) {
      return { error: "Market not found or unavailable." };
    }
    return snapshot;
  }
});

const researchMarket = tool({
  description: "Research a Kalshi market and produce a thesis",
  inputSchema: z.object({
    ticker: z.string()
  }),
  execute: async ({ ticker }) => {
    const research = await runResearch(ticker, resolveSessionId());
    if (!research) {
      return { error: "Market not found or unavailable." };
    }
    return {
      ticker: research.snapshot.ticker,
      snapshot: research.snapshot,
      news: research.news,
      bull_case: research.bull_case,
      bear_case: research.bear_case,
      base_case: research.base_case,
      key_risks: research.key_risks,
      invalidators: research.invalidators,
      p_agent: research.p_agent,
      confidence: research.confidence
    };
  }
});

const recommendTrade = tool({
  description: "Recommend a paper trade based on agent research and prices",
  inputSchema: z.object({
    ticker: z.string(),
    maxBet: z.number().optional()
  }),
  execute: async ({ ticker, maxBet }) => {
    const result = await getRecommendationForTicker(ticker, {
      maxBet,
      sessionId: resolveSessionId()
    });
    if (!result) {
      return { error: "Unable to generate recommendation." };
    }
    return {
      ticker,
      p_agent: result.research.p_agent,
      p_market: result.pMarket,
      ...result.recommendation
    };
  }
});

const addToWatchlist = tool({
  description: "Add a ticker to the watchlist",
  inputSchema: z.object({
    ticker: z.string()
  }),
  execute: async ({ ticker }) => {
    const state = getSessionState(resolveSessionId());
    state.watchlist.add(ticker);
    return { watchlist: Array.from(state.watchlist) };
  }
});

const removeFromWatchlist = tool({
  description: "Remove a ticker from the watchlist",
  inputSchema: z.object({
    ticker: z.string()
  }),
  execute: async ({ ticker }) => {
    const state = getSessionState(resolveSessionId());
    state.watchlist.delete(ticker);
    return { watchlist: Array.from(state.watchlist) };
  }
});

const listWatchlist = tool({
  description: "List tickers in the watchlist",
  inputSchema: z.object({}),
  execute: async () => {
    const state = getSessionState(resolveSessionId());
    return { watchlist: Array.from(state.watchlist) };
  }
});

const logTrade = tool({
  description: "Log a paper trade",
  inputSchema: z.object({
    ticker: z.string(),
    side: z.enum(["YES", "NO"]),
    size: z.number(),
    price: z.number()
  }),
  execute: async ({ ticker, side, size, price }) => {
    const state = getSessionState(resolveSessionId());
    state.trades.push({
      ticker,
      side,
      size,
      entryPrice: price,
      entryTime: new Date().toISOString()
    });
    return { trades: state.trades };
  }
});

const listTrades = tool({
  description: "List logged paper trades",
  inputSchema: z.object({}),
  execute: async () => {
    const state = getSessionState(resolveSessionId());
    return { trades: state.trades };
  }
});

const setAlertThreshold = tool({
  description: "Set alert threshold for watchlist recommendation changes",
  inputSchema: z.object({
    delta: z.number()
  }),
  execute: async ({ delta }) => {
    const state = getSessionState(resolveSessionId());
    state.alertDelta = clamp(delta, 0, 1);
    return { alertDelta: state.alertDelta };
  }
});

const scheduleWatchlistChecks = tool({
  description: "Schedule periodic watchlist checks",
  inputSchema: z.object({
    frequencyMinutes: z.number().int().positive()
  }),
  execute: async ({ frequencyMinutes }) => {
    const { cron, normalizedMinutes, note } = minutesToCron(frequencyMinutes);
    const message = await scheduleTaskInternal({
      description: CHECK_WATCHLIST_PAYLOAD,
      when: {
        type: "cron",
        cron
      }
    });

    return {
      message,
      cron,
      frequencyMinutes: normalizedMinutes,
      note
    };
  }
});

const checkWatchlist = tool({
  description: "Check watchlist and alert on recommendation changes",
  inputSchema: z.object({}),
  execute: async () => runCheckWatchlist(resolveSessionId())
});

const postMortem = tool({
  description: "Generate a post-mortem after market resolution",
  inputSchema: z.object({
    ticker: z.string(),
    outcome: z.enum(["YES", "NO"])
  }),
  execute: async ({ ticker, outcome }) => {
    const state = getSessionState(resolveSessionId());
    const lastRecommendation = state.lastRecommendationByTicker[ticker];
    const lastTrade = [...state.trades].reverse().find((trade) => trade.ticker === ticker);

    const prompt = `You are MarketScout. A market has resolved.

Ticker: ${ticker}
Outcome: ${outcome}
Last recommendation: ${lastRecommendation ? JSON.stringify(lastRecommendation) : "None"}
Last trade: ${lastTrade ? JSON.stringify(lastTrade) : "None"}

Provide a concise post-mortem summary with lessons learned and improvements.`;

    const postMortemSchema = z.object({
      summary: z.string(),
      lessons: z.array(z.string()),
      improvements: z.array(z.string())
    });

    const { object } = await generateObject({
      model,
      schema: postMortemSchema,
      prompt
    });

    const result: PostMortem = {
      ticker,
      outcome,
      summary: object.summary.trim(),
      lessons: object.lessons.map((lesson) => lesson.trim()).filter(Boolean),
      improvements: object.improvements
        .map((improvement) => improvement.trim())
        .filter(Boolean),
      generatedAt: new Date().toISOString()
    };

    state.postMortemsByTicker[ticker] = result;
    return result;
  }
});

export const tools = {
  analyzeMarket,
  researchMarket,
  recommendTrade,
  addToWatchlist,
  removeFromWatchlist,
  listWatchlist,
  logTrade,
  listTrades,
  setAlertThreshold,
  scheduleWatchlistChecks,
  checkWatchlist,
  postMortem
} satisfies ToolSet;

export const executions = {};

export { parseScheduledPayload, CHECK_WATCHLIST_PAYLOAD };
