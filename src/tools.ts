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
  fetchMarketSnapshotsForEvent,
  type MarketSnapshot
} from "./lib/kalshi";
import { fetchTopNewsWithFallback, type Article } from "./lib/news";
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
import {
  clamp01,
  computeAgentProbability,
  computeConfidence,
  runScoringSanityChecks,
  type Claim,
  type ConfidenceResult
} from "./lib/scoring";

const model = openai("gpt-4o-2024-11-20");
const CHECK_WATCHLIST_PAYLOAD = JSON.stringify({ type: "checkWatchlist" });

const claimSchema = z.object({
  text: z.string(),
  polarity: z.enum(["YES", "NO", "NEUTRAL"]),
  source: z.string(),
  is_numeric: z.boolean(),
  recency_hours: z.number(),
  reliability: z.number()
});

const researchSchema = z.object({
  delta: z.number(),
  claims: z.array(claimSchema),
  bull_case: z.array(z.string()),
  bear_case: z.array(z.string()),
  base_case: z.array(z.string()),
  key_risks: z.array(z.string()),
  invalidators: z.array(z.string())
});

type ScheduleInput = z.infer<typeof scheduleSchema>;

type RecommendationResult = {
  recommendation: Recommendation;
  snapshot: MarketSnapshot;
  research: MarketResearch;
  pMarket: number;
  delta: number;
  pAgent: number;
  confidence: number;
  confidenceBreakdown: ConfidenceResult;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-0.2, Math.min(0.2, value));
}

function clampHours(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(720, value));
}

function normalizeClaim(raw: Claim): Claim {
  return {
    text: raw.text?.trim() || "insufficient evidence",
    polarity: raw.polarity ?? "NEUTRAL",
    source: raw.source?.trim() || "",
    is_numeric: Boolean(raw.is_numeric),
    recency_hours: clampHours(raw.recency_hours),
    reliability: clamp01(raw.reliability)
  };
}

function formatArticles(
  articles: {
    title: string;
    source: string;
    publishedAt: string;
    url: string;
  }[]
): string {
  if (!articles.length) return "No articles available.";
  return articles
    .map(
      (article, index) =>
        `${index + 1}. ${article.title} — ${article.source} — ${article.publishedAt} — ${article.url}`
    )
    .join("\n");
}

function extractAnchorTerms(snapshot: {
  title: string;
  description?: string;
  ticker?: string;
}): string[] {
  const title = snapshot.title ?? "";
  const description = snapshot.description ?? "";
  const ticker = snapshot.ticker ?? "";
  const terms: string[] = [];

  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (
      !terms.find(
        (existing) => existing.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      terms.push(trimmed);
    }
  };

  const ifMatch = description.match(/\bIf\s+([^,]+),\s+then/i);
  if (ifMatch?.[1]) {
    const subject = ifMatch[1].trim();
    const subjectMatch = subject.match(
      /^([A-Z][A-Za-z0-9.&-]*(?:\s+[A-Z][A-Za-z0-9.&-]*)*)/
    );
    if (subjectMatch?.[1]) {
      add(subjectMatch[1]);
    }
  }

  const properMatches = description.match(
    /([A-Z][A-Za-z0-9.&-]*(?:\s+[A-Z][A-Za-z0-9.&-]*)*)/g
  );
  if (properMatches) {
    properMatches.forEach((match) => add(match));
  }

  const acronymMatches = title.match(/\b[A-Z]{2,}\b/g);
  if (acronymMatches) {
    acronymMatches.forEach((match) => add(match));
  }

  const tickerParts = ticker.split("-").filter(Boolean);
  tickerParts.forEach((part) => {
    if (/^[A-Z]{2,}$/.test(part)) {
      add(part);
    }
  });

  return terms;
}

function filterArticlesBySnapshot(
  articles: Article[],
  snapshot: { title: string; description?: string; ticker?: string }
): Article[] {
  if (!articles.length) return articles;
  const anchors = extractAnchorTerms(snapshot);
  if (!anchors.length) return articles;

  const stopwords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "in",
    "on",
    "at",
    "for",
    "with",
    "without",
    "by",
    "before",
    "after",
    "to",
    "from"
  ]);

  const anchorTokens = new Set<string>();
  anchors.forEach((anchor) => {
    anchorTokens.add(anchor.toLowerCase());
    anchor
      .split(/\s+/)
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 3)
      .filter((token) => !stopwords.has(token))
      .forEach((token) => anchorTokens.add(token));
  });

  return articles.filter((article) => {
    const haystack =
      `${article.title} ${article.description ?? ""}`.toLowerCase();
    return Array.from(anchorTokens).some((token) => haystack.includes(token));
  });
}

function formatClaims(claims: Claim[]): string {
  if (!claims.length) return "No claims provided.";
  return claims
    .map(
      (claim) =>
        `- [${claim.polarity}] ${claim.text} (${claim.source || "unsourced"})`
    )
    .join("\n");
}

function buildNewsQueries(snapshot: {
  title: string;
  description?: string;
  ticker?: string;
  category?: string;
}): string[] {
  const queries: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!queries.includes(trimmed)) {
      queries.push(trimmed);
    }
  };

  const title = snapshot.title ?? "";
  const description = snapshot.description ?? "";
  const ticker = snapshot.ticker ?? "";
  const category = snapshot.category ?? "";
  const rawText = `${title} ${description} ${category}`.trim();

  const stopwords = new Set([
    "will",
    "be",
    "above",
    "below",
    "by",
    "before",
    "after",
    "the",
    "a",
    "an",
    "if",
    "is",
    "are",
    "to",
    "of",
    "in",
    "on",
    "at",
    "for",
    "from",
    "with",
    "without",
    "over",
    "under",
    "between",
    "during",
    "until",
    "whether",
    "does",
    "do",
    "did",
    "has",
    "have",
    "had",
    "can",
    "could",
    "would",
    "should",
    "might",
    "may",
    "market",
    "price",
    "resolve",
    "resolution",
    "yes",
    "no",
    "above",
    "below",
    "over",
    "under",
    "hit",
    "reach",
    "wins",
    "win",
    "before",
    "after",
    "who",
    "what",
    "when",
    "where",
    "why",
    "how",
    "which"
  ]);

  const months = new Set([
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "sept",
    "oct",
    "nov",
    "dec"
  ]);

  const normalized = rawText
    .replace(/['’"]/g, "")
    .replace(/[^a-zA-Z0-9\\s]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();

  const orderedTokens = normalized
    .split(" ")
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3)
    .filter((token) => !stopwords.has(token))
    .filter((token) => !months.has(token))
    .filter((token) => {
      if (/^\\d+$/.test(token)) {
        const year = Number(token);
        return year >= 1900 && year <= 2100;
      }
      return true;
    });

  const freq = new Map<string, number>();
  orderedTokens.forEach((token) => {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  });

  const topTokens = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .slice(0, 6);

  const phraseScores = new Map<string, number>();
  for (let i = 0; i < orderedTokens.length; i += 1) {
    const tokenA = orderedTokens[i];
    const tokenB = orderedTokens[i + 1];
    const tokenC = orderedTokens[i + 2];
    if (tokenA && tokenB) {
      const bigram = `${tokenA} ${tokenB}`;
      const score = (freq.get(tokenA) ?? 1) + (freq.get(tokenB) ?? 1);
      phraseScores.set(bigram, (phraseScores.get(bigram) ?? 0) + score);
    }
    if (tokenA && tokenB && tokenC) {
      const trigram = `${tokenA} ${tokenB} ${tokenC}`;
      const score =
        (freq.get(tokenA) ?? 1) +
        (freq.get(tokenB) ?? 1) +
        (freq.get(tokenC) ?? 1);
      phraseScores.set(trigram, (phraseScores.get(trigram) ?? 0) + score);
    }
  }

  const topPhrases = [...phraseScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([phrase]) => phrase)
    .slice(0, 4);

  const entityScores = new Map<string, { value: string; score: number }>();
  const addEntity = (value: string, score: number) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    const lower = cleaned.toLowerCase();
    if (cleaned.length < 2) return;
    if (stopwords.has(lower) || months.has(lower)) return;
    if (/^\\d+$/.test(cleaned)) return;
    const existing = entityScores.get(lower);
    if (existing) {
      existing.score += score;
    } else {
      entityScores.set(lower, { value: cleaned, score });
    }
  };

  const ifMatch = description.match(/\\bIf\\s+([^,]+),\\s+then/i);
  if (ifMatch?.[1]) {
    const subject = ifMatch[1].trim();
    const subjectMatch = subject.match(
      /^([A-Z][A-Za-z0-9.&-]*(?:\\s+[A-Z][A-Za-z0-9.&-]*)*)/
    );
    if (subjectMatch?.[1]) {
      addEntity(subjectMatch[1], 5);
    }
  }

  const properFromDescription = description.match(
    /([A-Z][A-Za-z0-9.&-]*(?:\\s+[A-Z][A-Za-z0-9.&-]*)*)/g
  );
  if (properFromDescription) {
    properFromDescription.forEach((match) => addEntity(match, 3));
  }

  const properFromTitle = title.match(
    /([A-Z][A-Za-z0-9.&-]*(?:\\s+[A-Z][A-Za-z0-9.&-]*)*)/g
  );
  if (properFromTitle) {
    properFromTitle.forEach((match) => addEntity(match, 2));
  }

  const acronyms = rawText.match(/\\b[A-Z]{2,}\\b/g);
  if (acronyms) {
    acronyms.forEach((match) => addEntity(match, 2));
  }

  const quotedMatches = rawText.match(/\"([^\"]{3,})\"/g);
  if (quotedMatches) {
    quotedMatches.forEach((match) => addEntity(match.replace(/\"/g, ""), 2));
  }

  const tickerParts = ticker.split("-").filter(Boolean);
  tickerParts.forEach((part) => {
    if (/^[A-Z]{2,}$/.test(part)) {
      addEntity(part, 4);
    }
  });

  const topEntities = [...entityScores.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.value)
    .slice(0, 3);

  if (topTokens.length) {
    push(topTokens.join(" "));
  }

  topPhrases.forEach((phrase) => push(phrase));
  topEntities.forEach((entity) => push(entity));

  const topTerms = topTokens.slice(0, 3);
  if (topEntities.length && topTerms.length) {
    for (const entity of topEntities) {
      for (const term of topTerms) {
        push(`${entity} ${term}`);
      }
    }
  }

  if (topEntities.length && topPhrases.length) {
    for (const entity of topEntities) {
      for (const phrase of topPhrases.slice(0, 2)) {
        push(`${entity} ${phrase}`);
      }
    }
  }

  const yearTokens = topTokens.filter((token) => /^\\d{4}$/.test(token));
  if (yearTokens.length && topEntities.length) {
    for (const entity of topEntities) {
      for (const year of yearTokens) {
        push(`${entity} ${year}`);
      }
    }
  }

  return queries.slice(0, 12);
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

function readEnv(
  key: "KALSHI_API_KEY" | "NEWS_API_KEY" | "NEWS_API_PROXY_URL"
): string | undefined {
  if (typeof process !== "undefined" && process.env?.[key]) {
    return process.env[key];
  }
  const { agent } = getCurrentAgent<Chat>();
  const env = (agent as unknown as { env?: Record<string, string> })?.env;
  return env?.[key];
}

function getCurrentPosition(
  trades: Array<{ ticker: string; side: TradeSide }>,
  ticker: string
): Position {
  const lastTrade = [...trades]
    .reverse()
    .find((trade) => trade.ticker === ticker);
  return lastTrade ? lastTrade.side : "NONE";
}

function daysToResolution(resolutionDate: string): number {
  if (!resolutionDate) return 0;
  const target = new Date(resolutionDate);
  if (Number.isNaN(target.getTime())) return 0;
  const diffMs = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function parseScheduledPayload(
  payload: string
): { type: "checkWatchlist" } | null {
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
    return {
      cron: "*/30 * * * *",
      normalizedMinutes: 30,
      note: "Defaulted to 30 minutes."
    };
  }

  if (frequencyMinutes < 60) {
    return {
      cron: `*/${frequencyMinutes} * * * *`,
      normalizedMinutes: frequencyMinutes
    };
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
  runScoringSanityChecks();
  const state = getSessionState(resolveSessionId(sessionId));
  const existing = state.lastResearchByTicker[ticker];
  if (
    existing &&
    Array.isArray(existing.claims) &&
    typeof existing.delta === "number" &&
    typeof existing.p_market === "number" &&
    existing.confidenceBreakdown
  ) {
    return existing;
  }

  const apiKey = readEnv("KALSHI_API_KEY");
  const snapshot = await fetchMarketSnapshot(ticker, apiKey);
  if (!snapshot) return null;

  const newsKey = readEnv("NEWS_API_KEY");
  const newsProxy = readEnv("NEWS_API_PROXY_URL");
  const {
    articles,
    usedQueries,
    errors: newsErrors
  } = await fetchTopNewsWithFallback(
    buildNewsQueries(snapshot),
    newsKey,
    newsProxy
  );
  const filteredArticles = filterArticlesBySnapshot(articles, snapshot);

  const pMarket = snapshot.yesPrice;
  const prompt = `You are MarketScout, a Kalshi prediction-market research assistant.

Market snapshot:
${JSON.stringify(snapshot, null, 2)}

Recent headlines:
${articles.length ? articles.map((article, index) => `${index + 1}. ${article.title} — ${article.source} — ${article.publishedAt} — ${article.url}`).join("\n") : "No recent headlines available."}

Market prior (p_market) from pricing: ${pMarket.toFixed(3)}.

Provide a concise research brief. Use only the snapshot and headlines provided.
- Use p_market as the prior; output only a delta adjustment in [-0.20, +0.20].
- If evidence is weak, keep delta near 0 and include an \"insufficient evidence\" claim.
- Claims must be grounded only in the provided articles or market description.
- recency_hours should be conservative (24-168 if unknown).
- reliability must be 0..1 (lower for weaker evidence).
- If a claim has no clear source, set source to an empty string.
- bull_case, bear_case, base_case should be short bullet points (arrays of strings).
- key_risks and invalidators should be short bullet lists.
`;

  let object: z.infer<typeof researchSchema> | null = null;
  let parseFailed = false;
  try {
    const result = await generateObject({
      model,
      schema: researchSchema,
      prompt
    });
    object = result.object;
  } catch (error) {
    console.error("researchMarket parse error", error);
    parseFailed = true;
  }

  const delta = clampDelta(object?.delta ?? 0);
  const claims = (object?.claims ?? []).map(normalizeClaim);
  const days = daysToResolution(snapshot.resolutionDate);
  const confidenceBreakdown = computeConfidence(claims, days);
  const confidenceValue = parseFailed ? 0.3 : confidenceBreakdown.confidence;
  const pAgent = computeAgentProbability(pMarket, delta);

  const research: MarketResearch = {
    snapshot,
    articles: filteredArticles,
    newsQueries: usedQueries,
    newsErrors,
    bull_case: object?.bull_case
      ?.map((item) => item.trim())
      .filter(Boolean) ?? ["Insufficient data to form a bull case."],
    bear_case: object?.bear_case
      ?.map((item) => item.trim())
      .filter(Boolean) ?? ["Insufficient data to form a bear case."],
    base_case: object?.base_case
      ?.map((item) => item.trim())
      .filter(Boolean) ?? ["Insufficient data to form a base case."],
    key_risks: object?.key_risks
      ?.map((risk) => risk.trim())
      .filter(Boolean) ?? ["Insufficient data to identify key risks."],
    invalidators: object?.invalidators
      ?.map((invalidator) => invalidator.trim())
      .filter(Boolean) ?? ["Insufficient data to identify invalidators."],
    claims,
    p_market: pMarket,
    delta,
    p_agent: pAgent,
    confidence: confidenceValue,
    confidenceBreakdown: {
      ...confidenceBreakdown,
      confidence: confidenceValue
    },
    generatedAt: new Date().toISOString()
  };

  state.researchByTicker[ticker] = research;
  state.lastResearchByTicker[ticker] = research;
  return research;
}

async function getRecommendationForTicker(
  ticker: string,
  options?: {
    maxBet?: number;
    snapshotOverride?: MarketSnapshot;
    sessionId?: string;
  }
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
  const delta = clampDelta(research.delta);
  const pAgent = computeAgentProbability(pMarket, delta);
  const confidenceBreakdown = computeConfidence(research.claims, days);
  const confidence = confidenceBreakdown.confidence;

  const recommendation = makeRecommendation(
    pAgent,
    pMarket,
    confidence,
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
    pMarket,
    delta,
    pAgent,
    confidence,
    confidenceBreakdown
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
    const displayText = [
      "MARKET PRIOR",
      `- Market YES price: ${research.p_market.toFixed(3)}`,
      "",
      "EVIDENCE DELTA",
      `- Delta: ${research.delta >= 0 ? "+" : ""}${research.delta.toFixed(3)}`,
      "",
      "AGENT PROBABILITY",
      `- p_agent: ${research.p_agent.toFixed(3)}`,
      "",
      "CONFIDENCE BREAKDOWN",
      `- Recency: ${research.confidenceBreakdown.breakdown.recencyScore.toFixed(2)}`,
      `- Source quality: ${research.confidenceBreakdown.breakdown.sourceQualityScore.toFixed(2)}`,
      `- Multiplicity: ${research.confidenceBreakdown.breakdown.multiplicityScore.toFixed(2)}`,
      `- Specificity: ${research.confidenceBreakdown.breakdown.specificityScore.toFixed(2)}`,
      `- Time factor: ${research.confidenceBreakdown.breakdown.timeFactorScore.toFixed(2)}`,
      `- Final confidence: ${research.confidence.toFixed(2)}`,
      "",
      "CONFIDENCE INPUTS",
      `- Claims: ${research.confidenceBreakdown.details.numClaims}`,
      `- Distinct sources: ${research.confidenceBreakdown.details.distinctSources}`,
      `- Avg recency (hours): ${research.confidenceBreakdown.details.avgRecencyHours.toFixed(1)}`,
      `- Numeric claim rate: ${research.confidenceBreakdown.details.numericClaimRate.toFixed(2)}`,
      `- Days to resolution: ${research.confidenceBreakdown.details.daysToResolution.toFixed(0)}`,
      "",
      "ARTICLES USED",
      formatArticles(research.articles),
      "",
      "NEWS QUERIES USED",
      research.newsQueries && research.newsQueries.length
        ? research.newsQueries.map((query) => `- ${query}`).join("\n")
        : "No queries executed.",
      "",
      "NEWS FETCH ERRORS",
      research.newsErrors && research.newsErrors.length
        ? research.newsErrors.map((err) => `- ${err}`).join("\n")
        : "None",
      "",
      "CLAIMS",
      formatClaims(research.claims)
    ].join("\n");

    return {
      ticker: research.snapshot.ticker,
      snapshot: research.snapshot,
      articles: research.articles,
      newsQueries: research.newsQueries ?? [],
      newsErrors: research.newsErrors ?? [],
      bull_case: research.bull_case,
      bear_case: research.bear_case,
      base_case: research.base_case,
      key_risks: research.key_risks,
      invalidators: research.invalidators,
      claims: research.claims,
      p_market: research.p_market,
      delta: research.delta,
      p_agent: research.p_agent,
      confidence: research.confidence,
      confidenceBreakdown: research.confidenceBreakdown,
      scoreExplanationText: [
        "Score explanation:",
        `- Market prior (p_market): ${(research.p_market * 100).toFixed(1)}%`,
        `- Delta from evidence: ${(research.delta * 100).toFixed(1)} pts (bounded)`,
        `- Agent probability (p_agent): ${(research.p_agent * 100).toFixed(1)}%`,
        `- Confidence: ${(research.confidence * 100).toFixed(1)}%`,
        `  recency: ${research.confidenceBreakdown.breakdown.recencyScore.toFixed(2)}`,
        `  sourceQuality: ${research.confidenceBreakdown.breakdown.sourceQualityScore.toFixed(2)}`,
        `  multiplicity: ${research.confidenceBreakdown.breakdown.multiplicityScore.toFixed(2)}`,
        `  specificity: ${research.confidenceBreakdown.breakdown.specificityScore.toFixed(2)}`,
        `  timeFactor: ${research.confidenceBreakdown.breakdown.timeFactorScore.toFixed(2)}`,
        `  inputs: claims=${research.confidenceBreakdown.details.numClaims}, sources=${research.confidenceBreakdown.details.distinctSources}, avgRecencyHours=${research.confidenceBreakdown.details.avgRecencyHours.toFixed(1)}, numericRate=${research.confidenceBreakdown.details.numericClaimRate.toFixed(2)}, daysToResolution=${research.confidenceBreakdown.details.daysToResolution.toFixed(0)}`
      ].join("\n"),
      displayText
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
    const explanation = {
      p_market: result.pMarket,
      delta: result.delta,
      p_agent: result.pAgent,
      confidence: result.confidence,
      breakdown: result.confidenceBreakdown.breakdown
    };
    const scoreExplanationText = [
      "Score explanation:",
      `- Market prior (p_market): ${(result.pMarket * 100).toFixed(1)}%`,
      `- Delta from evidence: ${(result.delta * 100).toFixed(1)} pts (bounded)`,
      `- Agent probability (p_agent): ${(result.pAgent * 100).toFixed(1)}%`,
      `- Confidence: ${(result.confidence * 100).toFixed(1)}%`,
      `  recency: ${result.confidenceBreakdown.breakdown.recencyScore.toFixed(2)}`,
      `  sourceQuality: ${result.confidenceBreakdown.breakdown.sourceQualityScore.toFixed(2)}`,
      `  multiplicity: ${result.confidenceBreakdown.breakdown.multiplicityScore.toFixed(2)}`,
      `  specificity: ${result.confidenceBreakdown.breakdown.specificityScore.toFixed(2)}`,
      `  timeFactor: ${result.confidenceBreakdown.breakdown.timeFactorScore.toFixed(2)}`,
      `  inputs: claims=${result.confidenceBreakdown.details.numClaims}, sources=${result.confidenceBreakdown.details.distinctSources}, avgRecencyHours=${result.confidenceBreakdown.details.avgRecencyHours.toFixed(1)}, numericRate=${result.confidenceBreakdown.details.numericClaimRate.toFixed(2)}, daysToResolution=${result.confidenceBreakdown.details.daysToResolution.toFixed(0)}`
    ].join("\n");
    const displayText = [
      "MARKET PRIOR",
      `- Market YES price: ${result.pMarket.toFixed(3)}`,
      "",
      "EVIDENCE DELTA",
      `- Delta: ${result.delta >= 0 ? "+" : ""}${result.delta.toFixed(3)}`,
      "",
      "AGENT PROBABILITY",
      `- p_agent: ${result.pAgent.toFixed(3)}`,
      "",
      "CONFIDENCE BREAKDOWN",
      `- Recency: ${result.confidenceBreakdown.breakdown.recencyScore.toFixed(2)}`,
      `- Source quality: ${result.confidenceBreakdown.breakdown.sourceQualityScore.toFixed(2)}`,
      `- Multiplicity: ${result.confidenceBreakdown.breakdown.multiplicityScore.toFixed(2)}`,
      `- Specificity: ${result.confidenceBreakdown.breakdown.specificityScore.toFixed(2)}`,
      `- Time factor: ${result.confidenceBreakdown.breakdown.timeFactorScore.toFixed(2)}`,
      `- Final confidence: ${result.confidence.toFixed(2)}`,
      "",
      "CONFIDENCE INPUTS",
      `- Claims: ${result.confidenceBreakdown.details.numClaims}`,
      `- Distinct sources: ${result.confidenceBreakdown.details.distinctSources}`,
      `- Avg recency (hours): ${result.confidenceBreakdown.details.avgRecencyHours.toFixed(1)}`,
      `- Numeric claim rate: ${result.confidenceBreakdown.details.numericClaimRate.toFixed(2)}`,
      `- Days to resolution: ${result.confidenceBreakdown.details.daysToResolution.toFixed(0)}`,
      "",
      "ARTICLES USED",
      formatArticles(result.research.articles),
      "",
      "NEWS QUERIES USED",
      result.research.newsQueries && result.research.newsQueries.length
        ? result.research.newsQueries.map((query) => `- ${query}`).join("\n")
        : "No queries executed.",
      "",
      "NEWS FETCH ERRORS",
      result.research.newsErrors && result.research.newsErrors.length
        ? result.research.newsErrors.map((err) => `- ${err}`).join("\n")
        : "None",
      "",
      "CLAIMS",
      formatClaims(result.research.claims)
    ].join("\n");
    return {
      ticker,
      p_market: result.pMarket,
      delta: result.delta,
      p_agent: result.pAgent,
      articles: result.research.articles,
      newsQueries: result.research.newsQueries ?? [],
      newsErrors: result.research.newsErrors ?? [],
      claims: result.research.claims,
      confidenceBreakdown: result.confidenceBreakdown,
      scoreExplanation: explanation,
      scoreExplanationText,
      displayText,
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
  })
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
  })
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
  })
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

export const executions = {
  logTrade: async ({
    ticker,
    side,
    size,
    price
  }: {
    ticker: string;
    side: TradeSide;
    size: number;
    price: number;
  }) => {
    const state = getSessionState(resolveSessionId());
    state.trades.push({
      ticker,
      side,
      size,
      entryPrice: price,
      entryTime: new Date().toISOString()
    });
    return { trades: state.trades };
  },
  scheduleWatchlistChecks: async ({
    frequencyMinutes
  }: {
    frequencyMinutes: number;
  }) => {
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
  },
  postMortem: async ({
    ticker,
    outcome
  }: {
    ticker: string;
    outcome: TradeSide;
  }) => {
    const state = getSessionState(resolveSessionId());
    const lastRecommendation = state.lastRecommendationByTicker[ticker];
    const lastTrade = [...state.trades]
      .reverse()
      .find((trade) => trade.ticker === ticker);

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
};

export { parseScheduledPayload, CHECK_WATCHLIST_PAYLOAD };
