# Kalshi Prediction Market Agent

This repo is a Kalshi market research and paper-trading assistant built on Cloudflare Agents, React, and OpenAI. It is no longer the stock Cloudflare chat starter: the app now behaves like a prediction-market workflow tool that can analyze Kalshi markets, build a research brief, score evidence, recommend paper trades, monitor a watchlist, and generate post-mortems after resolution.

In the code, the agent prompt calls the product `MarketScout`. In the UI, it is labeled `Kalshi Agent`.

## What Is Implemented

- Analyze a Kalshi ticker or market URL and normalize the result into a market snapshot.
- Expand a Kalshi market URL into the broader event or series and list multiple active outcomes.
- Pull recent headlines through NewsAPI when research is requested and NewsAPI is configured.
- Ask the LLM for structured research only: bounded delta, claims, bull case, bear case, base case, risks, and invalidators.
- Compute `p_agent` and confidence deterministically instead of letting the model invent them.
- Turn the research output into a recommendation: `BUY_YES`, `BUY_NO`, `HOLD`, `EXIT`, or `FLIP`.
- Manage a watchlist, run manual checks, and schedule recurring watchlist checks.
- Log paper trades with human approval and review them in the dashboard.
- Generate post-mortems for resolved markets with human approval.
- Expose a debug panel showing LLM prompts, tool calls, and tool outputs.

## How The Agent Works

### 1. Market analysis

`analyzeMarket` accepts either:

- A Kalshi ticker like `KXBTC-25DEC31-B110000`
- A full Kalshi URL like `https://kalshi.com/markets/...`

The Kalshi adapter in [`src/lib/kalshi.ts`](./src/lib/kalshi.ts):

- Parses tickers from URLs
- Fetches market data from Kalshi's trade API
- Normalizes prices into `0..1`
- Fills in missing YES or NO prices when only one side is present
- Returns a normalized `MarketSnapshot`

If the input looks like a Kalshi market URL, the app can also fetch all outcomes for the matching event or series and display the active markets together.

### 2. Research generation

`researchMarket`:

- Fetches the current market snapshot
- Builds several news queries from the market title, description, ticker, and category
- Pulls recent headlines from NewsAPI
- Filters the headlines against anchor terms extracted from the market itself
- Sends only the market snapshot and headlines to the LLM

The model is asked for structured output only:

- `delta`
- `claims`
- `bull_case`
- `bear_case`
- `base_case`
- `key_risks`
- `invalidators`

The code explicitly constrains the evidence delta to `[-0.20, +0.20]`.

### 3. Deterministic scoring

The score pipeline is implemented in [`src/lib/scoring.ts`](./src/lib/scoring.ts).

- `p_market` is the current Kalshi YES price.
- `p_agent = clamp(p_market + delta, 0, 1)`.
- `confidence` is computed locally from:
  - claim recency
  - source quality
  - number of distinct sources
  - numeric claim rate
  - time to resolution

This is important to the current design: the LLM proposes evidence structure, but the final probability and confidence are computed in code.

### 4. Recommendation logic

Trade recommendations are produced in [`src/lib/recommendation.ts`](./src/lib/recommendation.ts).

Inputs:

- `p_agent`
- `p_market`
- computed confidence
- liquidity assumption
- days to resolution
- current paper position
- configured max bet

Outputs:

- `BUY_YES`
- `BUY_NO`
- `HOLD`
- `EXIT`
- `FLIP`

When the edge is large enough, the recommendation also includes a size bucket:

- `SMALL`
- `MEDIUM`
- `LARGE`

The UI exposes the full score explanation, confidence breakdown, article list, and extracted claims so the recommendation is inspectable.

## Product Surface

The React dashboard in [`src/app.tsx`](./src/app.tsx) is organized into these tabs:

- `Analyze`: paste a ticker or Kalshi URL, inspect market snapshots, and launch research.
- `Watchlist`: track selected tickers, refresh prices, run checks, and enable scheduled monitoring.
- `Trades`: review logged paper trades and current prices.
- `Alerts`: inspect recommendation changes and edge shifts from watchlist checks.
- `Journal`: review generated post-mortems after market resolution.
- `Settings`: configure max bet, alert threshold, and watchlist check frequency.
- `Debug`: inspect prompts, tool inputs, tool outputs, and system events.

The right-side detail panel shows:

- market snapshot
- recommendation details
- confidence breakdown
- articles used
- claims
- bull, bear, and base cases
- risks and invalidators

## Tooling And Approval Flow

The backend tool layer lives in [`src/tools.ts`](./src/tools.ts).

Implemented tools:

- `analyzeMarket`
- `researchMarket`
- `recommendTrade`
- `addToWatchlist`
- `removeFromWatchlist`
- `listWatchlist`
- `logTrade`
- `listTrades`
- `setAlertThreshold`
- `scheduleWatchlistChecks`
- `checkWatchlist`
- `postMortem`

These actions require human approval in the UI before they execute:

- `logTrade`
- `scheduleWatchlistChecks`
- `postMortem`

This means the app is built for assisted research and paper trading, not autonomous live execution.

## State And Persistence

There are two different persistence models in the current implementation:

- Server-side market state in [`src/lib/state.ts`](./src/lib/state.ts) is stored in an in-memory `Map` keyed by session id.
- Client-side UI preferences and alert history are stored in browser `localStorage`.

That means:

- watchlists are not durable database records yet
- paper trades are not persisted to external storage
- research snapshots and post-mortems are session-scoped in memory
- settings, selected tab, and alert history persist in the browser

## Environment Variables

Create a `.dev.vars` file for local development.

```env
OPENAI_API_KEY=your_openai_api_key

# Optional, if your Kalshi access requires auth
KALSHI_API_KEY=your_kalshi_api_key

# Optional, enables headline research
NEWS_API_KEY=your_newsapi_key

# Optional, point to a local or hosted NewsAPI proxy instead of hitting NewsAPI directly
NEWS_API_PROXY_URL=http://localhost:8788

# Optional Cloudflare AI Gateway base URL if you switch server.ts to use it
# GATEWAY_BASE_URL=https://gateway.ai.cloudflare.com/v1/...
```

Notes:

- `OPENAI_API_KEY` is required by the current server implementation.
- `NEWS_API_KEY` is optional, but without it the research flow will return little or no article evidence.
- The Kalshi adapter currently targets `https://api.elections.kalshi.com/trade-api/v2`.

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.dev.vars` with the environment variables above.

3. Start the app:

   ```bash
   npm start
   ```

4. Deploy when ready:

   ```bash
   npm run deploy
   ```

Useful commands:

```bash
npm test
npm run check
```

## Optional News Proxy

This repo includes a tiny local proxy at [`scripts/news-proxy.mjs`](./scripts/news-proxy.mjs).

Run it like this:

```bash
NEWS_API_KEY=your_newsapi_key node scripts/news-proxy.mjs
```

Then point the app at it with:

```env
NEWS_API_PROXY_URL=http://localhost:8788
```

## Important Implementation Notes

- This project does not place real trades.
- The recommendation engine is meant for paper trading and research support.
- Confidence is computed in code, not directly trusted from the LLM.
- Recommendation thresholds depend on confidence, a fixed liquidity assumption, and time to resolution.
- The current test suite is still mostly starter-level and does not deeply validate market or research behavior.
- Some starter-era names still remain in config, such as the package name and Wrangler worker name, even though the product behavior is Kalshi-specific now.

## Key Files

- [`src/server.ts`](./src/server.ts): Cloudflare agent entry point and system prompt
- [`src/tools.ts`](./src/tools.ts): tool definitions, research orchestration, approvals, watchlist checks
- [`src/lib/kalshi.ts`](./src/lib/kalshi.ts): Kalshi API adapter and market normalization
- [`src/lib/news.ts`](./src/lib/news.ts): NewsAPI integration and fallback query aggregation
- [`src/lib/scoring.ts`](./src/lib/scoring.ts): deterministic probability and confidence math
- [`src/lib/recommendation.ts`](./src/lib/recommendation.ts): recommendation threshold and action logic
- [`src/lib/state.ts`](./src/lib/state.ts): session-scoped in-memory state
- [`src/app.tsx`](./src/app.tsx): dashboard shell and approval UI
- [`src/components/Tabs`](./src/components/Tabs): tab-level product UI

## License

MIT
