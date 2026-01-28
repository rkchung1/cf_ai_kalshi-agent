import { Card } from "@/components/card/Card";
import { Button } from "@/components/button/Button";
import { useAppState } from "@/context/AppStateContext";

export function AlertsTab() {
  const { alerts, setSelectedTicker } = useAppState();

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-white">
        <h2 className="text-lg font-semibold text-neutral-900">Alerts</h2>
        <p className="text-sm text-neutral-500">
          Recommendation changes and edge shifts from watchlist checks.
        </p>
      </Card>

      <Card className="bg-white">
        {alerts.length === 0 && (
          <p className="text-sm text-neutral-500">No alerts yet.</p>
        )}
        <ul className="space-y-3 text-sm text-neutral-600">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-3 last:border-0"
            >
              <div>
                <div className="font-medium text-neutral-800">
                  {alert.ticker ?? "Alert"}
                </div>
                <div className="text-xs text-neutral-400">
                  {new Date(alert.timestamp).toLocaleString()}
                </div>
                <p className="mt-1">{alert.message}</p>
              </div>
              {alert.ticker && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSelectedTicker(alert.ticker ?? null)}
                >
                  View Details
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
