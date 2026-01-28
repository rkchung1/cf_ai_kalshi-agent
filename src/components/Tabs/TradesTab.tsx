import { useState } from "react";
import { Card } from "@/components/card/Card";
import { Button } from "@/components/button/Button";
import { ActionBadge } from "@/components/Badges";
import { useAppState } from "@/context/AppStateContext";

export function TradesTab() {
  const {
    trades,
    snapshots,
    setSelectedTicker,
    setSelectedTrade,
    runTool,
    updateSnapshot
  } = useAppState();
  const [loading, setLoading] = useState(false);

  const handleRefreshPrices = async () => {
    setLoading(true);
    for (const trade of trades) {
      const snapshot = await runTool("analyzeMarket", {
        tickerOrUrl: trade.ticker
      });
      if (snapshot && typeof snapshot === "object" && "ticker" in snapshot) {
        updateSnapshot(snapshot as { ticker: string });
      }
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Trades</h2>
            <p className="text-sm text-neutral-500">
              Review paper trades and monitor current prices.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshPrices}
            loading={loading}
          >
            Refresh prices
          </Button>
        </div>
      </Card>

      <Card className="bg-white">
        <div className="grid grid-cols-7 gap-3 text-xs uppercase text-neutral-400">
          <div>Ticker</div>
          <div>Side</div>
          <div>Size</div>
          <div>Entry</div>
          <div>Entry Time</div>
          <div>Current YES</div>
          <div>Status</div>
        </div>
        <div className="mt-2 divide-y divide-neutral-100 text-sm text-neutral-600">
          {trades.length === 0 && (
            <div className="py-6 text-center text-sm text-neutral-500">
              No trades logged yet.
            </div>
          )}
          {trades.map((trade) => {
            const snapshot = snapshots[trade.ticker];
            return (
              <button
                key={`${trade.ticker}-${trade.entryTime}`}
                type="button"
                onClick={() => {
                  setSelectedTicker(trade.ticker);
                  setSelectedTrade(trade);
                }}
                className="grid w-full grid-cols-7 gap-3 py-3 text-left hover:bg-neutral-50"
              >
                <div className="font-medium text-neutral-800">{trade.ticker}</div>
                <div>{trade.side === "YES" ? <ActionBadge action="BUY_YES" /> : <ActionBadge action="BUY_NO" />}</div>
                <div>{trade.size}</div>
                <div>{trade.entryPrice.toFixed(3)}</div>
                <div>{new Date(trade.entryTime).toLocaleString()}</div>
                <div>{snapshot?.yesPrice?.toFixed(3) ?? "—"}</div>
                <div>{trade.status ?? "Open"}</div>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
