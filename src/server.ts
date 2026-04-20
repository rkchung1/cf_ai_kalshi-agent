import { routeAgentRequest, type Schedule } from "agents";

import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls, cleanupMessages } from "./utils";
import {
  tools,
  executions,
  parseScheduledPayload,
  runCheckWatchlist
} from "./tools";
// import { env } from "cloudflare:workers";

const model = openai("gpt-4o-2024-11-20");
// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Ensure MCP jsonSchema is loaded before calling getAITools()
    await this.mcp.ensureJsonSchema();

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are MarketScout.

You must:
- If the user provides a Kalshi URL or ticker and only asks to analyze/inspect the market, call analyzeMarket only.
- Do NOT run researchMarket or recommendTrade unless the user explicitly asks for research, probability, recommendations, or a trade.
- Fetch news articles with researchMarket (it uses NewsAPI) only when explicitly requested.
- Ask the LLM only for delta + structured claims + thesis.
- Compute p_agent and confidence deterministically.
- Always explain how scores were computed and show articles + claims.
- Never invent probabilities.
- Never hide articles or evidence.

When researchMarket or recommendTrade returns displayText or scoreExplanationText,
include that text verbatim in your response so the user can see the sources and scoring.

Use researchMarket to build theses and probabilities.
Use recommendTrade to produce BUY/SELL/HOLD decisions.
Use addToWatchlist/removeFromWatchlist/listWatchlist for tracking.
Use logTrade and listTrades for paper trades (confirmation required).
Use scheduleWatchlistChecks and checkWatchlist to monitor markets.
Use postMortem after resolution.

Never invent market data.
Never place real trades.
Only recommend trades when edge exceeds threshold.`,

          messages: await convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10),
          abortSignal: options?.abortSignal
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    const parsed = parseScheduledPayload(description);
    if (parsed?.type === "checkWatchlist") {
      const result = await runCheckWatchlist(this.name);
      await this.saveMessages([
        ...this.messages,
        {
          id: generateId(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: `Watchlist check complete. Alerts: ${
                result.alerts.length ? result.alerts.join(" | ") : "none"
              }`
            }
          ],
          metadata: {
            createdAt: new Date()
          }
        }
      ]);
      return;
    }

    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
