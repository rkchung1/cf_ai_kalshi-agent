/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useMemo, useRef, useState, use } from "react";
import { AppStateProvider, useAppState } from "@/context/AppStateContext";
import { Sidebar } from "@/components/Sidebar";
import { AnalyzeTab } from "@/components/Tabs/AnalyzeTab";
import { WatchlistTab } from "@/components/Tabs/WatchlistTab";
import { TradesTab } from "@/components/Tabs/TradesTab";
import { AlertsTab } from "@/components/Tabs/AlertsTab";
import { JournalTab } from "@/components/Tabs/JournalTab";
import { SettingsTab } from "@/components/Tabs/SettingsTab";
import { DebugTab } from "@/components/Tabs/DebugTab";
import { ResearchDetails } from "@/components/ResearchDetails";
import { TradeModal } from "@/components/TradeModal";
import { Card } from "@/components/card/Card";
import { Button } from "@/components/button/Button";
import { Select } from "@/components/select/Select";

function DashboardApp() {
  const {
    selectedTab,
    setSelectedTab,
    selectedTicker,
    selectedTrade,
    snapshots,
    research,
    recommendations,
    trades,
    settings,
    runTool,
    setWatchlist,
    setTrades,
    updateSnapshot,
    updateResearch,
    updateRecommendation,
    addPostMortem,
    approvals,
    approveToolCall,
    status
  } = useAppState();

  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [postMortemOutcome, setPostMortemOutcome] = useState<"YES" | "NO">(
    "YES"
  );
  const [postMortemLoading, setPostMortemLoading] = useState(false);
  const initialLoad = useRef(false);

  const snapshot = selectedTicker ? snapshots[selectedTicker] : undefined;
  const researchResult = selectedTicker ? research[selectedTicker] : undefined;
  const recommendation = selectedTicker
    ? recommendations[selectedTicker]
    : undefined;
  const suggestedSide: "YES" | "NO" = recommendation?.action === "BUY_NO" ? "NO" : "YES";
  const suggestedSize = (() => {
    if (!recommendation?.size) return 10;
    if (recommendation.size === "SMALL") return settings.maxBet * 0.25;
    if (recommendation.size === "MEDIUM") return settings.maxBet * 0.5;
    if (recommendation.size === "LARGE") return settings.maxBet * 1.0;
    return 10;
  })();

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;

    runTool("listWatchlist", {})
      .then((result) => {
        if (result && typeof result === "object" && "watchlist" in result) {
          setWatchlist((result as { watchlist: string[] }).watchlist);
        }
      })
      .catch(() => null);

    runTool("listTrades", {})
      .then((result) => {
        if (result && typeof result === "object" && "trades" in result) {
          setTrades((result as { trades: typeof trades }).trades);
        }
      })
      .catch(() => null);
  }, [runTool, setTrades, setWatchlist, trades]);

  const handleRecommend = async () => {
    if (!selectedTicker) return;
    const result = await runTool("recommendTrade", {
      ticker: selectedTicker,
      maxBet: settings.maxBet
    });
    if (result && typeof result === "object") {
      if ("snapshot" in result) {
        updateSnapshot((result as { snapshot: { ticker: string } }).snapshot);
      }
      if ("research" in result) {
        updateResearch(
          selectedTicker,
          (result as { research: Record<string, unknown> }).research
        );
      }
      updateRecommendation(selectedTicker, result as Record<string, unknown>);
    }
  };

  const handleAddWatchlist = async () => {
    if (!selectedTicker) return;
    const result = await runTool("addToWatchlist", {
      ticker: selectedTicker
    });
    if (result && typeof result === "object" && "watchlist" in result) {
      setWatchlist((result as { watchlist: string[] }).watchlist);
    }
  };

  const handleLogTrade = async (payload: {
    side: "YES" | "NO";
    size: number;
    price: number;
  }) => {
    if (!selectedTicker) return;
    setTradeLoading(true);
    const result = await runTool("logTrade", {
      ticker: selectedTicker,
      ...payload
    });
    if (result && typeof result === "object" && "trades" in result) {
      setTrades((result as { trades: typeof trades }).trades);
      setSelectedTab("trades");
    }
    setTradeLoading(false);
  };

  const handlePostMortem = async () => {
    if (!selectedTrade) return;
    setPostMortemLoading(true);
    const result = await runTool("postMortem", {
      ticker: selectedTrade.ticker,
      outcome: postMortemOutcome
    });
    if (result && typeof result === "object") {
      addPostMortem(result as { ticker: string; outcome: "YES" | "NO" });
      setSelectedTab("journal");
    }
    setPostMortemLoading(false);
  };

  const activeView = useMemo(() => {
    switch (selectedTab) {
      case "watchlist":
        return <WatchlistTab />;
      case "trades":
        return <TradesTab />;
      case "journal":
        return <JournalTab />;
      case "alerts":
        return <AlertsTab />;
      case "settings":
        return <SettingsTab />;
      case "debug":
        return <DebugTab />;
      case "analyze":
      default:
        return <AnalyzeTab />;
    }
  }, [selectedTab]);

  return (
    <div className="flex h-screen w-full bg-neutral-50 text-neutral-900">
      <HasOpenAIKey />
      <div className="hidden h-full w-64 lg:block">
        <Sidebar selectedTab={selectedTab} onSelect={setSelectedTab} />
      </div>
      <div className="flex h-full flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-neutral-400">
              Kalshi Agent
            </div>
            <h1 className="text-lg font-semibold">
              Market Research & Analysis
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="lg:hidden">
              <Select
                options={[
                  { value: "analyze" },
                  { value: "watchlist" },
                  { value: "trades" },
                  { value: "journal" },
                  { value: "alerts" },
                  { value: "settings" },
                  { value: "debug" }
                ]}
                value={selectedTab}
                setValue={(value) => setSelectedTab(value as typeof selectedTab)}
                size="sm"
              />
            </div>
            <div className="text-xs text-neutral-500">Status: {status}</div>
          </div>
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <main className="flex-1 overflow-y-auto px-6 py-6">{activeView}</main>

          <aside className="hidden h-full w-[420px] overflow-y-auto border-l border-neutral-200 bg-neutral-50 px-5 py-6 lg:block">
            {selectedTrade && (
              <Card className="mb-4 bg-white">
                <h3 className="text-sm font-semibold text-neutral-800">
                  Trade Detail
                </h3>
                <div className="mt-2 text-sm text-neutral-600">
                  <div>Ticker: {selectedTrade.ticker}</div>
                  <div>Side: {selectedTrade.side}</div>
                  <div>Size: {selectedTrade.size}</div>
                  <div>Entry: {selectedTrade.entryPrice.toFixed(3)}</div>
                  <div>
                    Entry Time: {new Date(selectedTrade.entryTime).toLocaleString()}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Select
                    options={[{ value: "YES" }, { value: "NO" }]}
                    value={postMortemOutcome}
                    setValue={(value) =>
                      setPostMortemOutcome(value as "YES" | "NO")
                    }
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handlePostMortem}
                    loading={postMortemLoading}
                  >
                    Generate Post-Mortem
                  </Button>
                </div>
              </Card>
            )}
            <ResearchDetails
              snapshot={snapshot}
              research={researchResult}
              recommendation={recommendation}
              onAddWatchlist={handleAddWatchlist}
              onLogTrade={() => setTradeModalOpen(true)}
              onRecommend={handleRecommend}
              loading={tradeLoading}
            />
          </aside>
        </div>

        {selectedTicker && (
          <div className="border-t border-neutral-200 bg-white px-6 py-4 lg:hidden">
            <ResearchDetails
              snapshot={snapshot}
              research={researchResult}
              recommendation={recommendation}
              onAddWatchlist={handleAddWatchlist}
              onLogTrade={() => setTradeModalOpen(true)}
              onRecommend={handleRecommend}
              loading={tradeLoading}
            />
          </div>
        )}

        {approvals.length > 0 && (
          <div className="border-t border-neutral-200 bg-neutral-100 px-6 py-4">
            <h3 className="text-sm font-semibold text-neutral-800">
              Pending Approvals
            </h3>
            <div className="mt-2 space-y-2">
              {approvals.map((approval) => (
                <Card key={approval.toolCallId} className="bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-neutral-800">
                        {approval.toolName}
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap rounded-md bg-neutral-50 p-2 text-xs text-neutral-600">
                        {JSON.stringify(approval.input, null, 2)}
                      </pre>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          approveToolCall(
                            approval.toolCallId,
                            approval.toolName,
                            true
                          )
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          approveToolCall(
                            approval.toolCallId,
                            approval.toolName,
                            false
                          )
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      <TradeModal
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        snapshot={snapshot}
        defaultSide={suggestedSide}
        defaultSize={suggestedSize}
        onSubmit={handleLogTrade}
      />
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <DashboardApp />
    </AppStateProvider>
  );
}

const hasOpenAiKeyPromise = fetch("/check-open-ai-key").then((res) =>
  res.json<{ success: boolean }>()
);

function HasOpenAIKey() {
  const hasOpenAiKey = use(hasOpenAiKeyPromise);

  if (!hasOpenAiKey.success) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-500/10 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-lg border border-red-200 dark:border-red-900 p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                <svg
                  className="w-5 h-5 text-red-600 dark:text-red-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-labelledby="warningIcon"
                >
                  <title id="warningIcon">Warning Icon</title>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
                  OpenAI API Key Not Configured
                </h3>
                <p className="text-neutral-600 dark:text-neutral-300 mb-1">
                  Requests to the API, including from the frontend UI, will not
                  work until an OpenAI API key is configured.
                </p>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Please configure an OpenAI API key by setting a{" "}
                  <a
                    href="https://developers.cloudflare.com/workers/configuration/secrets/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-600 dark:text-red-400"
                  >
                    secret
                  </a>{" "}
                  named{" "}
                  <code className="bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded text-red-600 dark:text-red-400 font-mono text-sm">
                    OPENAI_API_KEY
                  </code>
                  . <br />
                  You can also use a different model provider by following these{" "}
                  <a
                    href="https://github.com/cloudflare/agents-starter?tab=readme-ov-file#use-a-different-ai-model-provider"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-600 dark:text-red-400"
                  >
                    instructions.
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
