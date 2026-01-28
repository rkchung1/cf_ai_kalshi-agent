import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "@ai-sdk/react";
import { isStaticToolUIPart } from "ai";
import { APPROVAL } from "@/shared";

export type TabKey =
  | "analyze"
  | "watchlist"
  | "trades"
  | "journal"
  | "alerts"
  | "settings"
  | "debug";

export type MarketSnapshot = {
  ticker: string;
  title?: string;
  yesPrice?: number;
  noPrice?: number;
  resolutionDate?: string;
  category?: string;
  description?: string;
  [key: string]: unknown;
};

export type ResearchResult = {
  ticker?: string;
  snapshot?: MarketSnapshot;
  articles?: Array<{
    title: string;
    source: string;
    publishedAt: string;
    url: string;
    description?: string;
  }>;
  claims?: Array<{
    text: string;
    polarity: string;
    source: string;
    is_numeric: boolean;
    recency_hours: number;
    reliability: number;
  }>;
  bull_case?: string[];
  bear_case?: string[];
  base_case?: string[];
  key_risks?: string[];
  invalidators?: string[];
  p_market?: number;
  delta?: number;
  p_agent?: number;
  confidence?: number;
  confidenceBreakdown?: {
    confidence?: number;
    breakdown?: {
      recencyScore?: number;
      sourceQualityScore?: number;
      multiplicityScore?: number;
      specificityScore?: number;
      timeFactorScore?: number;
    };
    details?: {
      numClaims?: number;
      distinctSources?: number;
      avgRecencyHours?: number;
      numericClaimRate?: number;
      daysToResolution?: number;
    };
  };
  scoreExplanationText?: string;
  displayText?: string;
  newsQueries?: string[];
  newsErrors?: string[];
  [key: string]: unknown;
};

export type RecommendationResult = {
  ticker?: string;
  action?: string;
  edge?: number;
  threshold?: number;
  confidence?: number;
  size?: string | null;
  reasoning?: string[];
  displayText?: string;
  scoreExplanationText?: string;
  p_market?: number;
  p_agent?: number;
  delta?: number;
  [key: string]: unknown;
};

export type Trade = {
  ticker: string;
  side: "YES" | "NO";
  size: number;
  entryPrice: number;
  entryTime: string;
  status?: string;
};

export type AlertItem = {
  id: string;
  timestamp: string;
  ticker?: string;
  title?: string;
  message: string;
  previousAction?: string;
  nextAction?: string;
  previousEdge?: number;
  nextEdge?: number;
};

export type PostMortem = {
  ticker: string;
  outcome: "YES" | "NO";
  summary?: string;
  lessons?: string[];
  improvements?: string[];
  generatedAt?: string;
};

export type DebugEntry = {
  id: string;
  timestamp: string;
  type: "llm_input" | "llm_output" | "tool_call" | "tool_output" | "system";
  toolName?: ToolName;
  label?: string;
  payload: unknown;
};

export type Settings = {
  maxBet: number;
  alertThreshold: number;
  frequencyMinutes: number;
  riskMode: "Conservative" | "Balanced" | "Aggressive";
  scheduled: boolean;
};

type ToolName =
  | "analyzeMarket"
  | "researchMarket"
  | "recommendTrade"
  | "addToWatchlist"
  | "removeFromWatchlist"
  | "listWatchlist"
  | "logTrade"
  | "listTrades"
  | "setAlertThreshold"
  | "scheduleWatchlistChecks"
  | "checkWatchlist"
  | "postMortem";

type PendingRequest = {
  toolName: ToolName;
  input: unknown;
  key: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type ApprovalItem = {
  toolCallId: string;
  toolName: ToolName;
  input: unknown;
};

type AppState = {
  selectedTab: TabKey;
  setSelectedTab: (tab: TabKey) => void;
  selectedTicker: string | null;
  setSelectedTicker: (ticker: string | null) => void;
  selectedTrade: Trade | null;
  setSelectedTrade: (trade: Trade | null) => void;
  analysisInput: string;
  setAnalysisInput: (value: string) => void;
  analysisResult: unknown;
  setAnalysisResult: (value: unknown) => void;
  snapshots: Record<string, MarketSnapshot>;
  research: Record<string, ResearchResult>;
  recommendations: Record<string, RecommendationResult>;
  watchlist: string[];
  trades: Trade[];
  alerts: AlertItem[];
  postMortems: PostMortem[];
  debugLogs: DebugEntry[];
  settings: Settings;
  setSettings: (settings: Settings) => void;
  status: string;
  runTool: <T = unknown>(toolName: ToolName, input: unknown) => Promise<T>;
  approvals: ApprovalItem[];
  approveToolCall: (toolCallId: string, toolName: ToolName, approved: boolean) => void;
  updateSnapshot: (snapshot: MarketSnapshot) => void;
  updateResearch: (ticker: string, research: ResearchResult) => void;
  updateRecommendation: (ticker: string, recommendation: RecommendationResult) => void;
  setWatchlist: (tickers: string[]) => void;
  setTrades: (trades: Trade[]) => void;
  addAlert: (alert: AlertItem) => void;
  addPostMortem: (postMortem: PostMortem) => void;
  addDebugEntry: (entry: Omit<DebugEntry, "id" | "timestamp">) => void;
  clearDebugLogs: () => void;
};

const DEFAULT_SETTINGS: Settings = {
  maxBet: 50,
  alertThreshold: 0.04,
  frequencyMinutes: 30,
  riskMode: "Balanced",
  scheduled: false
};

const STORAGE_KEYS = {
  settings: "market-scout-settings",
  alerts: "market-scout-alerts",
  tab: "market-scout-tab"
};

const toolsRequiringConfirmation: ToolName[] = [
  "logTrade",
  "scheduleWatchlistChecks",
  "postMortem"
];

const AppStateContext = createContext<AppState | null>(null);

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const agent = useAgent({ agent: "chat" });
  const {
    messages,
    sendMessage,
    addToolResult,
    clearHistory,
    status
  } = useAgentChat<unknown, UIMessage<{ createdAt: string }>>({
    agent
  });

  const [selectedTab, setSelectedTab] = useState<TabKey>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.tab);
    return (saved as TabKey) || "analyze";
  });
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [analysisInput, setAnalysisInput] = useState("");
  const [analysisResult, setAnalysisResult] = useState<unknown>(null);
  const [snapshots, setSnapshots] = useState<Record<string, MarketSnapshot>>({});
  const [research, setResearch] = useState<Record<string, ResearchResult>>({});
  const [recommendations, setRecommendations] = useState<
    Record<string, RecommendationResult>
  >({});
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.alerts);
    if (!stored) return [];
    try {
      return JSON.parse(stored) as AlertItem[];
    } catch {
      return [];
    }
  });
  const [postMortems, setPostMortems] = useState<PostMortem[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.settings);
    if (!stored) return DEFAULT_SETTINGS;
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(stored) as Partial<Settings>) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const pendingRequests = useRef<PendingRequest[]>([]);
  const seenToolCalls = useRef<Set<string>>(new Set());
  const requestQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.alerts, JSON.stringify(alerts));
  }, [alerts]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.tab, selectedTab);
  }, [selectedTab]);

  const approvals = useMemo<ApprovalItem[]>(() => {
    const items: ApprovalItem[] = [];
    messages.forEach((message) => {
      message.parts?.forEach((part) => {
        if (!isStaticToolUIPart(part)) return;
        const toolName = part.type.replace("tool-", "") as ToolName;
        if (!toolsRequiringConfirmation.includes(toolName)) return;
        if (part.state !== "input-available") return;
        items.push({
          toolCallId: part.toolCallId,
          toolName,
          input: part.input
        });
      });
    });
    return items;
  }, [messages]);

  const addDebugEntry = useCallback(
    (entry: Omit<DebugEntry, "id" | "timestamp">) => {
      const next: DebugEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: new Date().toISOString(),
        ...entry
      };
      setDebugLogs((prev) => [next, ...prev].slice(0, 200));
    },
    []
  );

  const clearDebugLogs = useCallback(() => {
    setDebugLogs([]);
  }, []);

  const approveToolCall = useCallback(
    (toolCallId: string, toolName: ToolName, approved: boolean) => {
      addToolResult({
        tool: toolName,
        toolCallId,
        output: approved ? APPROVAL.YES : APPROVAL.NO
      });
      addDebugEntry({
        type: "system",
        toolName,
        label: approved ? "Tool approved" : "Tool rejected",
        payload: { toolCallId, approved }
      });
    },
    [addToolResult, addDebugEntry]
  );

  useEffect(() => {
    let resolvedAny = false;
    const hasPendingApprovals = messages.some((message) =>
      message.parts?.some((part) => {
        if (!isStaticToolUIPart(part)) return false;
        const toolName = part.type.replace("tool-", "") as ToolName;
        return toolsRequiringConfirmation.includes(toolName) && part.state === "input-available";
      })
    );

    messages.forEach((message) => {
      message.parts?.forEach((part) => {
        if (!isStaticToolUIPart(part)) return;
        if (part.state !== "output-available") return;
        if (seenToolCalls.current.has(part.toolCallId)) return;
        if (typeof part.output === "string") {
          if (part.output === APPROVAL.YES || part.output === APPROVAL.NO) {
            return;
          }
        }

        const toolName = part.type.replace("tool-", "") as ToolName;
        const key = `${toolName}:${stableStringify(part.input)}`;
        const index = pendingRequests.current.findIndex(
          (request) => request.key === key
        );
        if (index !== -1) {
          const request = pendingRequests.current[index];
          pendingRequests.current.splice(index, 1);
          seenToolCalls.current.add(part.toolCallId);
          addDebugEntry({
            type: "llm_output",
            toolName,
            label: "LLM tool call output",
            payload: { tool: toolName, input: part.input }
          });
          addDebugEntry({
            type: "tool_call",
            toolName,
            label: "Tool call input",
            payload: part.input
          });
          addDebugEntry({
            type: "tool_output",
            toolName,
            label: "Tool call output",
            payload: part.output
          });
          request.resolve(part.output);
          resolvedAny = true;
        }
      });
    });

    if (resolvedAny && !hasPendingApprovals) {
      clearHistory();
    }
  }, [messages, clearHistory, addDebugEntry]);

  const runTool = useCallback(
    <T,>(toolName: ToolName, input: unknown): Promise<T> => {
      const key = `${toolName}:${stableStringify(input)}`;
      const task = () =>
        new Promise<T>((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            pendingRequests.current = pendingRequests.current.filter(
              (request) => request.key !== key
            );
            addDebugEntry({
              type: "system",
              toolName,
              label: "Tool call timed out",
              payload: { toolName, input }
            });
            clearHistory();
            reject(new Error(`Tool call timed out: ${toolName}`));
          }, 30000);

          const resolveWithTimeout = (value: unknown) => {
            window.clearTimeout(timeoutId);
            resolve(value as T);
          };

          const rejectWithTimeout = (error: Error) => {
            window.clearTimeout(timeoutId);
            reject(error);
          };

          pendingRequests.current.push({
            toolName,
            input,
            key,
            resolve: resolveWithTimeout,
            reject: rejectWithTimeout
          });

          const prompt = `Use the ${toolName} tool with this JSON input:\n${JSON.stringify(
            input
          )}\nReturn only the tool result.`;

          addDebugEntry({
            type: "llm_input",
            toolName,
            label: "LLM prompt",
            payload: { prompt, input }
          });

          sendMessage({
            role: "user",
            parts: [{ type: "text", text: prompt }]
          }).catch((error: Error) => {
            pendingRequests.current = pendingRequests.current.filter(
              (request) => request.key !== key
            );
            rejectWithTimeout(error);
          });
        });

      requestQueue.current = requestQueue.current.then(task, task);
      return requestQueue.current as Promise<T>;
    },
    [sendMessage, addDebugEntry, clearHistory]
  );

  const updateSnapshot = useCallback((snapshot: MarketSnapshot) => {
    if (!snapshot?.ticker) return;
    setSnapshots((prev) => ({ ...prev, [snapshot.ticker]: snapshot }));
  }, []);

  const updateResearch = useCallback((ticker: string, result: ResearchResult) => {
    if (!ticker) return;
    setResearch((prev) => ({ ...prev, [ticker]: result }));
  }, []);

  const updateRecommendation = useCallback(
    (ticker: string, recommendation: RecommendationResult) => {
      if (!ticker) return;
      setRecommendations((prev) => ({ ...prev, [ticker]: recommendation }));
    },
    []
  );

  const addAlert = useCallback((alert: AlertItem) => {
    setAlerts((prev) => [alert, ...prev]);
  }, []);

  const addPostMortem = useCallback((postMortem: PostMortem) => {
    setPostMortems((prev) => [postMortem, ...prev]);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      selectedTab,
      setSelectedTab,
      selectedTicker,
      setSelectedTicker,
      selectedTrade,
      setSelectedTrade,
      analysisInput,
      setAnalysisInput,
      analysisResult,
      setAnalysisResult,
      snapshots,
      research,
      recommendations,
      watchlist,
      trades,
      alerts,
      postMortems,
      debugLogs,
      settings,
      setSettings,
      status,
      runTool,
      approvals,
      approveToolCall,
      updateSnapshot,
      updateResearch,
      updateRecommendation,
      setWatchlist,
      setTrades,
      addAlert,
      addPostMortem,
      addDebugEntry,
      clearDebugLogs
    }),
    [
      selectedTab,
      selectedTicker,
      selectedTrade,
      analysisInput,
      analysisResult,
      snapshots,
      research,
      recommendations,
      watchlist,
      trades,
      alerts,
      postMortems,
      debugLogs,
      settings,
      status,
      runTool,
      approvals,
      approveToolCall,
      updateSnapshot,
      updateResearch,
      updateRecommendation,
      setWatchlist,
      setTrades,
      addAlert,
      addPostMortem,
      addDebugEntry,
      clearDebugLogs
    ]
  );

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return context;
}
