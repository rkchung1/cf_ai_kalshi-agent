import { useState } from "react";
import { Button } from "@/components/button/Button";
import { Input } from "@/components/input/Input";
import { Card } from "@/components/card/Card";
import { useAppState, type MarketSnapshot } from "@/context/AppStateContext";

function SnapshotCard({
  snapshot,
  onSelect,
  onResearch
}: {
  snapshot: MarketSnapshot;
  onSelect: () => void;
  onResearch: () => void;
}) {
  return (
    <Card className="bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            {snapshot.title ?? snapshot.ticker}
          </h3>
          <p className="text-xs text-neutral-500">{snapshot.ticker}</p>
        </div>
        <div className="text-right text-xs text-neutral-500">
          YES {snapshot.yesPrice?.toFixed(3) ?? "—"} / NO{" "}
          {snapshot.noPrice?.toFixed(3) ?? "—"}
        </div>
      </div>
      {snapshot.description && (
        <p className="mt-2 text-sm text-neutral-600">{snapshot.description}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onSelect}>
          View Details
        </Button>
        <Button size="sm" variant="primary" onClick={onResearch}>
          Research Market
        </Button>
      </div>
    </Card>
  );
}

export function AnalyzeTab() {
  const {
    runTool,
    updateSnapshot,
    updateResearch,
    setSelectedTicker,
    settings,
    analysisInput,
    setAnalysisInput,
    analysisResult,
    setAnalysisResult
  } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!analysisInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const output = await runTool("analyzeMarket", {
        tickerOrUrl: analysisInput.trim(),
        allOutcomes: /kalshi\.com\/markets\//i.test(analysisInput)
      });
      setAnalysisResult(output);

      if (output && typeof output === "object" && "ticker" in output) {
        updateSnapshot(output as MarketSnapshot);
        setSelectedTicker((output as MarketSnapshot).ticker);
      } else if (
        output &&
        typeof output === "object" &&
        "markets" in output &&
        Array.isArray((output as { markets?: MarketSnapshot[] }).markets)
      ) {
        (output as { markets: MarketSnapshot[] }).markets.forEach((market) => {
          updateSnapshot(market);
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleResearch = async (ticker: string) => {
    setSelectedTicker(ticker);
    const research = await runTool("researchMarket", { ticker });
    if (research && typeof research === "object") {
      if ("snapshot" in research) {
        updateSnapshot((research as { snapshot: MarketSnapshot }).snapshot);
      }
      updateResearch(ticker, research as Record<string, unknown>);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-white">
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              Analyze a Market
            </h2>
            <p className="text-sm text-neutral-500">
              Paste a Kalshi URL or ticker to fetch current market data.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              onValueChange={(value) => setAnalysisInput(value)}
              initialValue={analysisInput}
              className="min-w-[240px] flex-1"
              placeholder="Paste Kalshi URL or ticker"
            />
            <Button variant="primary" onClick={handleAnalyze} loading={loading}>
              Analyze
            </Button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </Card>

      {analysisResult &&
      typeof analysisResult === "object" &&
      "error" in analysisResult ? (
        <Card className="bg-white">
          <p className="text-sm text-red-500">
            {(analysisResult as { error?: string }).error ??
              "Unable to analyze market."}
          </p>
        </Card>
      ) : null}

      {analysisResult &&
      typeof analysisResult === "object" &&
      "markets" in analysisResult
        ? (() => {
            const markets = (analysisResult as { markets: MarketSnapshot[] })
              .markets;
            const visible = markets.filter(
              (market) =>
                typeof market.yesPrice === "number" && market.yesPrice > 0.01
            );
            const hiddenCount = markets.length - visible.length;

            return (
              <div className="space-y-3">
                {hiddenCount > 0 && (
                  <Card className="bg-white text-sm text-neutral-500">
                    {hiddenCount} markets hidden because YES odds ≤ 1%.
                  </Card>
                )}
                <div className="grid gap-3 lg:grid-cols-2">
                  {visible.map((market) => (
                    <SnapshotCard
                      key={market.ticker}
                      snapshot={market}
                      onSelect={() => setSelectedTicker(market.ticker)}
                      onResearch={() => handleResearch(market.ticker)}
                    />
                  ))}
                </div>
              </div>
            );
          })()
        : null}

      {analysisResult &&
      typeof analysisResult === "object" &&
      "ticker" in analysisResult ? (
        <SnapshotCard
          snapshot={analysisResult as MarketSnapshot}
          onSelect={() =>
            setSelectedTicker((analysisResult as MarketSnapshot).ticker)
          }
          onResearch={() =>
            handleResearch((analysisResult as MarketSnapshot).ticker)
          }
        />
      ) : null}

      <Card className="bg-white">
        <p className="text-sm text-neutral-500">
          When you’re ready, research a specific market to see probabilities,
          confidence, and recommended actions. Default max bet:{" "}
          {settings.maxBet}.
        </p>
      </Card>
    </div>
  );
}
