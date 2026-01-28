import { useMemo, useState } from "react";
import { Button } from "@/components/button/Button";
import { Input } from "@/components/input/Input";
import { Select } from "@/components/select/Select";
import { Card } from "@/components/card/Card";
import { ActionBadge, ConfidenceBadge } from "@/components/Badges";
import { useAppState } from "@/context/AppStateContext";

function parseAlertMessage(message: string) {
  const match = message.match(
    /^([A-Z0-9_-]+):\s+([A-Z_]+)\s+->\s+([A-Z_]+)\s+\(edge\s+([0-9.]+)\s+->\s+([0-9.]+)\)/i
  );
  if (!match) return null;
  return {
    ticker: match[1],
    previousAction: match[2],
    nextAction: match[3],
    previousEdge: Number(match[4]),
    nextEdge: Number(match[5])
  };
}

export function WatchlistTab() {
  const {
    watchlist,
    snapshots,
    research,
    recommendations,
    runTool,
    setSelectedTicker,
    setSelectedTrade,
    setWatchlist,
    updateSnapshot,
    updateRecommendation,
    updateResearch,
    addAlert,
    settings,
    setSettings
  } = useAppState();
  const [newTicker, setNewTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [lastUpdatedTickers, setLastUpdatedTickers] = useState<Set<string>>(
    new Set()
  );

  const rows = useMemo(() => {
    return watchlist.map((ticker) => {
      const snapshot = snapshots[ticker];
      const rec = recommendations[ticker];
      const researchResult = research[ticker];
      return {
        ticker,
        title: snapshot?.title ?? ticker,
        yesPrice: snapshot?.yesPrice,
        resolutionDate: snapshot?.resolutionDate,
        action: rec?.action,
        pAgent: researchResult?.p_agent ?? rec?.p_agent,
        confidence: researchResult?.confidence ?? rec?.confidence
      };
    });
  }, [watchlist, snapshots, recommendations, research]);

  const handleAdd = async () => {
    if (!newTicker.trim()) return;
    const result = await runTool("addToWatchlist", { ticker: newTicker.trim() });
    if (result && typeof result === "object" && "watchlist" in result) {
      setWatchlist((result as { watchlist: string[] }).watchlist);
    }
    setNewTicker("");
  };

  const handleRemove = async (ticker: string) => {
    const result = await runTool("removeFromWatchlist", { ticker });
    if (result && typeof result === "object" && "watchlist" in result) {
      setWatchlist((result as { watchlist: string[] }).watchlist);
    }
  };

  const handleRefreshPrices = async () => {
    setLoading(true);
    for (const ticker of watchlist) {
      const snapshot = await runTool("analyzeMarket", { tickerOrUrl: ticker });
      if (snapshot && typeof snapshot === "object" && "ticker" in snapshot) {
        updateSnapshot(snapshot as { ticker: string });
      }
    }
    setLoading(false);
  };

  const handleCheckWatchlist = async () => {
    setLoading(true);
    const result = await runTool("checkWatchlist", {});
    if (result && typeof result === "object" && "alerts" in result) {
      const alerts = (result as { alerts?: string[] }).alerts ?? [];
      const updated = new Set<string>();
      alerts.forEach((message) => {
        const parsed = parseAlertMessage(message);
        if (parsed) {
          updated.add(parsed.ticker);
          addAlert({
            id: `${parsed.ticker}-${Date.now()}`,
            timestamp: new Date().toISOString(),
            ticker: parsed.ticker,
            message,
            previousAction: parsed.previousAction,
            nextAction: parsed.nextAction,
            previousEdge: parsed.previousEdge,
            nextEdge: parsed.nextEdge
          });
        } else {
          addAlert({
            id: `alert-${Date.now()}`,
            timestamp: new Date().toISOString(),
            message
          });
        }
      });
      setLastUpdatedTickers(updated);
    }
    setLoading(false);
  };

  const handleSchedule = async () => {
    setScheduleLoading(true);
    const result = await runTool("scheduleWatchlistChecks", {
      frequencyMinutes: settings.frequencyMinutes
    });
    if (result && typeof result === "object") {
      const normalized =
        "frequencyMinutes" in result
          ? (result as { frequencyMinutes?: number }).frequencyMinutes
          : settings.frequencyMinutes;
      setSettings({
        ...settings,
        scheduled: true,
        frequencyMinutes: normalized ?? settings.frequencyMinutes
      });
    }
    setScheduleLoading(false);
  };

  const handleRowClick = async (ticker: string) => {
    setSelectedTicker(ticker);
    setSelectedTrade(null);
    const result = await runTool("recommendTrade", {
      ticker,
      maxBet: settings.maxBet
    });
    if (result && typeof result === "object") {
      if ("snapshot" in result) {
        updateSnapshot((result as { snapshot: { ticker: string } }).snapshot);
      }
      if ("research" in result) {
        updateResearch(ticker, (result as { research: Record<string, unknown> }).research);
      }
      updateRecommendation(ticker, result as Record<string, unknown>);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-white">
        <h2 className="text-lg font-semibold text-neutral-900">Watchlist</h2>
        <p className="text-sm text-neutral-500">
          Track markets and run periodic checks for recommendation changes.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            onValueChange={(value) => setNewTicker(value)}
            initialValue={newTicker}
            placeholder="Add ticker"
            className="min-w-[200px]"
          />
          <Button variant="primary" size="sm" onClick={handleAdd}>
            Add
          </Button>
          <Button variant="secondary" size="sm" onClick={handleRefreshPrices} loading={loading}>
            Refresh prices
          </Button>
          <Button variant="secondary" size="sm" onClick={handleCheckWatchlist} loading={loading}>
            Run check now
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
          <span>Schedule checks every</span>
          <Select
            options={[{ value: "5" }, { value: "15" }, { value: "30" }, { value: "60" }]}
            value={String(settings.frequencyMinutes)}
            setValue={(value) =>
              setSettings({ ...settings, frequencyMinutes: Number(value) })
            }
            size="sm"
          />
          <span>minutes</span>
          <Button variant="secondary" size="sm" onClick={handleSchedule} loading={scheduleLoading}>
            Enable scheduled checks
          </Button>
        </div>
      </Card>

      <Card className="bg-white">
        <div className="grid grid-cols-6 gap-3 text-xs uppercase text-neutral-400">
          <div>Ticker</div>
          <div>Title</div>
          <div>YES</div>
          <div>Resolution</div>
          <div>Recommendation</div>
          <div>p_agent / Confidence</div>
        </div>
        <div className="mt-2 divide-y divide-neutral-100 text-sm text-neutral-600">
          {rows.length === 0 && (
            <div className="py-6 text-center text-sm text-neutral-500">
              No markets in watchlist yet.
            </div>
          )}
          {rows.map((row) => (
            <button
              key={row.ticker}
              type="button"
              onClick={() => handleRowClick(row.ticker)}
              className="grid w-full grid-cols-6 gap-3 py-3 text-left hover:bg-neutral-50"
            >
              <div className="font-medium text-neutral-800">
                {row.ticker}
                {lastUpdatedTickers.has(row.ticker) && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                    Updated
                  </span>
                )}
              </div>
              <div className="truncate">{row.title}</div>
              <div>{row.yesPrice?.toFixed(3) ?? "—"}</div>
              <div>{row.resolutionDate ? new Date(row.resolutionDate).toLocaleDateString() : "—"}</div>
              <div>{row.action ? <ActionBadge action={row.action} /> : "—"}</div>
              <div>
                {row.pAgent !== undefined ? row.pAgent.toFixed(2) : "—"} /{" "}
                {row.confidence !== undefined ? (
                  <ConfidenceBadge confidence={row.confidence} />
                ) : (
                  "—"
                )}
              </div>
              <div className="col-span-6 mt-2 flex justify-end gap-2 text-xs text-neutral-500">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemove(row.ticker);
                  }}
                >
                  Remove
                </Button>
              </div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
