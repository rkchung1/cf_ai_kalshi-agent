import {
  ChartLineUpIcon,
  ListMagnifyingGlassIcon,
  BellRingingIcon,
  ClipboardTextIcon,
  SlidersHorizontalIcon,
  WalletIcon,
  TargetIcon,
  BugIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { TabKey } from "@/context/AppStateContext";

const tabs: Array<{
  key: TabKey;
  label: string;
  icon: React.ReactNode;
}> = [
  { key: "analyze", label: "Analyze", icon: <TargetIcon size={18} /> },
  { key: "watchlist", label: "Watchlist", icon: <ListMagnifyingGlassIcon size={18} /> },
  { key: "trades", label: "Trades", icon: <WalletIcon size={18} /> },
  { key: "journal", label: "Journal", icon: <ClipboardTextIcon size={18} /> },
  { key: "alerts", label: "Alerts", icon: <BellRingingIcon size={18} /> },
  { key: "settings", label: "Settings", icon: <SlidersHorizontalIcon size={18} /> },
  { key: "debug", label: "Debug", icon: <BugIcon size={18} /> }
];

export function Sidebar({
  selectedTab,
  onSelect
}: {
  selectedTab: TabKey;
  onSelect: (tab: TabKey) => void;
}) {
  return (
    <aside className="flex h-full w-full flex-col gap-6 border-r border-neutral-200 bg-white px-4 py-6 text-neutral-800">
      <div>
        <div className="flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-neutral-400">
          <ChartLineUpIcon size={16} />
          Dashboard
        </div>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">
          Kalshi Agent
        </h1>
        <p className="text-sm text-neutral-500">Market Research & Analysis</p>
      </div>

      <nav className="flex flex-col gap-2">
        {tabs.map((tab) => {
          const isActive = tab.key === selectedTab;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelect(tab.key)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-neutral-900 text-white shadow-sm"
                  : "text-neutral-600 hover:bg-neutral-100"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
