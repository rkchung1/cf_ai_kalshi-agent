export interface MarketSnapshot {
  ticker: string;
  title: string;
  category: string;
  resolutionDate: string;
  yesPrice: number;
  noPrice: number;
  description: string;
}

const KALSHI_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const MARKET_LIST_STATUSES = ["open", "active", "closed", "settled"] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizePrice(value: unknown): number | null {
  const numeric = coerceNumber(value);
  if (numeric === null) return null;
  let normalized = numeric;
  // Kalshi prices are commonly expressed in cents (0-100). Treat integer cents as such.
  if (Number.isInteger(normalized) && normalized >= 0 && normalized <= 100) {
    normalized = normalized / 100;
  } else if (normalized > 1.01) {
    normalized = normalized / 100;
  }
  return clamp(normalized, 0, 1);
}

function normalizeDate(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return "";
}

function normalizeTicker(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null;
  return cleaned.replace(/[^a-zA-Z0-9-_]/g, "").toUpperCase();
}

function extractTicker(tickerOrUrl: string): string | null {
  const trimmed = tickerOrUrl.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const fromQuery = url.searchParams.get("ticker");
      if (fromQuery) return normalizeTicker(fromQuery);
      const segments = url.pathname.split("/").filter(Boolean);
      const candidate = segments[segments.length - 1];
      if (candidate) return normalizeTicker(candidate);
    } catch {
      return normalizeTicker(trimmed);
    }
  }

  return normalizeTicker(trimmed);
}

function extractUrlParts(tickerOrUrl: string): {
  isUrl: boolean;
  seriesOrEvent?: string;
  candidateSlug?: string;
  descriptiveSlug?: string;
} {
  const trimmed = tickerOrUrl.trim();
  if (!trimmed) return { isUrl: false };
  if (!/^https?:\/\//i.test(trimmed)) {
    return { isUrl: false };
  }
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const marketsIndex = segments.findIndex((segment) => segment === "markets");
    if (marketsIndex === -1) return { isUrl: true };

    const seriesOrEvent = segments[marketsIndex + 1];
    const descriptiveSlug =
      segments.length >= marketsIndex + 3
        ? segments[marketsIndex + 2]
        : undefined;
    const candidateSlug = segments[segments.length - 1];

    return {
      isUrl: true,
      seriesOrEvent,
      candidateSlug,
      descriptiveSlug
    };
  } catch {
    return { isUrl: true };
  }
}

function pickYesPrice(market: Record<string, unknown>): number | null {
  const direct =
    market.yes_price ??
    market.yesPrice ??
    market.yes_midpoint ??
    market.yes_mid ??
    market.last_price ??
    market.lastPrice;
  const directPrice = normalizePrice(direct);
  if (directPrice !== null) return directPrice;

  const bid = normalizePrice(market.yes_bid ?? market.yesBid);
  const ask = normalizePrice(market.yes_ask ?? market.yesAsk);
  if (bid !== null && ask !== null) {
    return clamp((bid + ask) / 2, 0, 1);
  }
  return null;
}

function pickNoPrice(market: Record<string, unknown>): number | null {
  const direct =
    market.no_price ?? market.noPrice ?? market.no_midpoint ?? market.no_mid;
  const directPrice = normalizePrice(direct);
  if (directPrice !== null) return directPrice;

  const bid = normalizePrice(market.no_bid ?? market.noBid);
  const ask = normalizePrice(market.no_ask ?? market.noAsk);
  if (bid !== null && ask !== null) {
    return clamp((bid + ask) / 2, 0, 1);
  }
  return null;
}

function normalizeMarketRecord(
  market: Record<string, unknown>
): MarketSnapshot | null {
  const ticker = normalizeTicker(
    String(market.ticker ?? market.market_ticker ?? "")
  );
  if (!ticker) return null;

  const title = (market.title ??
    market.name ??
    market.event_title ??
    market.eventTitle ??
    "") as string;
  const category = (market.category ??
    market.event_ticker ??
    market.series_ticker ??
    "") as string;
  const description = (market.description ??
    market.rules_primary ??
    market.rulesPrimary ??
    market.subtitle ??
    market.details ??
    "") as string;

  const resolutionDate = normalizeDate(
    market.close_time ??
      market.closeTime ??
      market.expiration_time ??
      market.expirationTime ??
      market.settlement_time ??
      market.settlementTime ??
      market.end_date ??
      market.endDate
  );

  let yesPrice = pickYesPrice(market);
  let noPrice = pickNoPrice(market);

  if (yesPrice === null && noPrice === null) {
    return null;
  }

  if (yesPrice === null && noPrice !== null) {
    yesPrice = clamp(1 - noPrice, 0, 1);
  }
  if (noPrice === null && yesPrice !== null) {
    noPrice = clamp(1 - yesPrice, 0, 1);
  }

  if (yesPrice === null || noPrice === null) {
    return null;
  }

  return {
    ticker,
    title,
    category,
    resolutionDate,
    yesPrice,
    noPrice,
    description
  };
}

function getResolutionTimestamp(
  market: Record<string, unknown>
): number | null {
  const rawDate =
    market.close_time ??
    market.closeTime ??
    market.expiration_time ??
    market.expirationTime ??
    market.settlement_time ??
    market.settlementTime ??
    market.end_date ??
    market.endDate;
  const normalized = normalizeDate(rawDate);
  if (!normalized) return null;
  const time = new Date(normalized).getTime();
  return Number.isNaN(time) ? null : time;
}

function getMarketTicker(market: Record<string, unknown>): string | null {
  const ticker =
    typeof market.ticker === "string"
      ? market.ticker
      : typeof market.market_ticker === "string"
        ? market.market_ticker
        : null;
  return ticker ? normalizeTicker(ticker) : null;
}

function uniqMarkets(
  markets: Record<string, unknown>[]
): Record<string, unknown>[] {
  const byTicker = new Map<string, Record<string, unknown>>();
  for (const market of markets) {
    const ticker = getMarketTicker(market);
    if (!ticker) continue;
    if (!byTicker.has(ticker)) {
      byTicker.set(ticker, market);
    }
  }
  return Array.from(byTicker.values());
}

async function fetchMarketByTicker(
  ticker: string,
  headers: Record<string, string>
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(
      `${KALSHI_API_BASE}/markets/${encodeURIComponent(ticker)}`,
      { headers }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    const market = (payload.market ?? payload) as Record<string, unknown>;
    return market;
  } catch {
    return null;
  }
}

async function fetchMarketsList(
  params: Record<string, string>,
  headers: Record<string, string>
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${KALSHI_API_BASE}/markets`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      markets?: Record<string, unknown>[];
    };
    return payload.markets ?? [];
  } catch {
    return [];
  }
}

function scoreMarketMatch(
  market: Record<string, unknown>,
  candidateTicker?: string,
  slugTokens?: string[]
): number {
  let score = 0;
  const ticker = normalizeTicker(String(market.ticker ?? ""));
  if (candidateTicker && ticker === candidateTicker) score += 100;
  if (candidateTicker && ticker?.includes(candidateTicker)) score += 50;

  const title = String(market.title ?? "").toLowerCase();
  if (slugTokens && slugTokens.length) {
    const matches = slugTokens.filter((token) => title.includes(token)).length;
    score += matches * 5;
  }

  return score;
}

async function fetchMarketsByFilter(
  filter: Record<string, string>,
  headers: Record<string, string>
): Promise<Record<string, unknown>[]> {
  const baseMarkets = await fetchMarketsList(filter, headers);
  if (baseMarkets.length > 0) return baseMarkets;

  let combined: Record<string, unknown>[] = [];
  for (const status of MARKET_LIST_STATUSES) {
    const markets = await fetchMarketsList({ ...filter, status }, headers);
    if (markets.length) {
      combined = combined.concat(markets);
    }
  }

  if (combined.length === 0) return [];
  return uniqMarkets(combined);
}

async function resolveMarketFromUrl(
  tickerOrUrl: string,
  headers: Record<string, string>
): Promise<Record<string, unknown> | null> {
  const parts = extractUrlParts(tickerOrUrl);
  if (!parts.isUrl) return null;

  const seriesOrEvent = parts.seriesOrEvent
    ? normalizeTicker(parts.seriesOrEvent)
    : null;
  const candidateTicker = parts.candidateSlug
    ? normalizeTicker(parts.candidateSlug)
    : null;

  if (candidateTicker) {
    const direct = await fetchMarketByTicker(candidateTicker, headers);
    if (direct) return direct;
  }

  if (!seriesOrEvent) return null;

  const descriptiveTokens = [parts.candidateSlug, parts.descriptiveSlug]
    .filter(Boolean)
    .flatMap((slug) =>
      String(slug)
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((token) => token.length > 2)
    );

  const marketsByEvent = await fetchMarketsByFilter(
    { event_ticker: seriesOrEvent, limit: "200" },
    headers
  );
  const marketsBySeries =
    marketsByEvent.length > 0
      ? marketsByEvent
      : await fetchMarketsByFilter(
          { series_ticker: seriesOrEvent, limit: "200" },
          headers
        );

  if (marketsBySeries.length === 0) return null;

  let best: Record<string, unknown> | null = null;
  let bestScore = -1;
  for (const market of marketsBySeries) {
    const score = scoreMarketMatch(
      market,
      candidateTicker ?? undefined,
      descriptiveTokens
    );
    if (score > bestScore) {
      best = market;
      bestScore = score;
    }
  }

  if (best) return best;
  if (marketsBySeries.length === 1) return marketsBySeries[0];

  return null;
}

export async function fetchMarketSnapshotsForEvent(
  tickerOrUrl: string,
  apiKey?: string
): Promise<{
  eventTicker: string | null;
  markets: MarketSnapshot[];
} | null> {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const parts = extractUrlParts(tickerOrUrl);
  const parsedTicker = extractTicker(tickerOrUrl);
  const candidateTickers: string[] = [];
  const pushCandidate = (value: string | null) => {
    if (!value) return;
    if (!candidateTickers.includes(value)) {
      candidateTickers.push(value);
    }
  };

  let marketFromTicker: Record<string, unknown> | null = null;
  if (parsedTicker) {
    pushCandidate(parsedTicker);
    marketFromTicker = await fetchMarketByTicker(parsedTicker, headers);
    if (marketFromTicker) {
      const eventFromMarket = normalizeTicker(
        String(marketFromTicker.event_ticker ?? "")
      );
      const seriesFromMarket = normalizeTicker(
        String(marketFromTicker.series_ticker ?? "")
      );
      pushCandidate(eventFromMarket);
      pushCandidate(seriesFromMarket);
    }
  }

  if (parts.seriesOrEvent) {
    const fromUrl = normalizeTicker(parts.seriesOrEvent);
    pushCandidate(fromUrl);
  }

  if (candidateTickers.length === 0) return null;

  let combinedMarkets: Record<string, unknown>[] = [];
  for (const ticker of candidateTickers) {
    const byEvent = await fetchMarketsByFilter(
      { event_ticker: ticker, limit: "200" },
      headers
    );
    const bySeries = await fetchMarketsByFilter(
      { series_ticker: ticker, limit: "200" },
      headers
    );
    combinedMarkets = combinedMarkets.concat(byEvent, bySeries);
  }

  const fallbackMarkets = uniqMarkets(combinedMarkets);
  if (fallbackMarkets.length === 0) return null;

  const now = Date.now();
  const activeMarkets = fallbackMarkets.filter((market) => {
    const statusRaw = String(
      market.status ?? market.market_status ?? ""
    ).toLowerCase();
    if (statusRaw) {
      const activeStatuses = new Set(["open", "active", "trading"]);
      const inactiveStatuses = new Set([
        "closed",
        "settled",
        "finalized",
        "expired",
        "inactive",
        "cancelled",
        "canceled"
      ]);
      if (activeStatuses.has(statusRaw)) return true;
      if (inactiveStatuses.has(statusRaw)) return false;
    }
    const resolutionTime = getResolutionTimestamp(market);
    return resolutionTime ? resolutionTime >= now : true;
  });

  const marketsToNormalize =
    activeMarkets.length > 0 ? activeMarkets : fallbackMarkets;

  const snapshots = marketsToNormalize
    .map((market) => normalizeMarketRecord(market))
    .filter((snapshot): snapshot is MarketSnapshot => Boolean(snapshot));

  return {
    eventTicker: candidateTickers[0] ?? null,
    markets: snapshots.sort((a, b) => {
      const aTime = new Date(a.resolutionDate).getTime();
      const bTime = new Date(b.resolutionDate).getTime();
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
      return aTime - bTime;
    })
  };
}

export async function fetchMarketSnapshot(
  tickerOrUrl: string,
  apiKey?: string
): Promise<MarketSnapshot | null> {
  const ticker = extractTicker(tickerOrUrl);
  if (!ticker) return null;
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const directMarket = await fetchMarketByTicker(ticker, headers);
  const resolvedMarket =
    directMarket ?? (await resolveMarketFromUrl(tickerOrUrl, headers));

  if (!resolvedMarket) return null;

  return normalizeMarketRecord(resolvedMarket);
}

export async function fetchMarketNews(
  title: string,
  apiKey?: string
): Promise<string[]> {
  if (!apiKey) return [];

  const query = encodeURIComponent(title);
  const url = `https://newsapi.org/v2/everything?q=${query}&pageSize=5&sortBy=publishedAt&language=en`;

  const response = await fetch(url, {
    headers: {
      "X-Api-Key": apiKey
    }
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    articles?: Array<{ title?: string }>;
  };

  const headlines = payload.articles
    ?.map((article) => article.title)
    .filter((title): title is string => Boolean(title))
    .slice(0, 5);

  return headlines ?? [];
}
