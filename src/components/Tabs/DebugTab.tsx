import { Card } from "@/components/card/Card";
import { Button } from "@/components/button/Button";
import { Select } from "@/components/select/Select";
import { useState } from "react";
import { useAppState, type DebugEntry } from "@/context/AppStateContext";

function formatPayload(payload: unknown) {
  if (payload === undefined) return "undefined";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

const typeOptions = [
  "all",
  "llm_input",
  "llm_output",
  "tool_call",
  "tool_output",
  "system"
];

export function DebugTab() {
  const { debugLogs, clearDebugLogs } = useAppState();
  const [filter, setFilter] = useState("all");

  const visibleLogs =
    filter === "all"
      ? debugLogs
      : debugLogs.filter((entry) => entry.type === filter);

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Debug Panel</h2>
            <p className="text-sm text-neutral-500">
              Inspect LLM prompts, tool calls, and JSON inputs/outputs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              options={typeOptions.map((value) => ({ value }))}
              value={filter}
              setValue={setFilter}
              size="sm"
            />
            <Button variant="secondary" size="sm" onClick={clearDebugLogs}>
              Clear Logs
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        {visibleLogs.length === 0 && (
          <Card className="bg-white text-sm text-neutral-500">
            No debug entries yet.
          </Card>
        )}
        {visibleLogs.map((entry: DebugEntry) => (
          <Card key={entry.id} className="bg-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase text-neutral-400">
                  {entry.type.replace("_", " ")}
                </div>
                <div className="text-sm font-semibold text-neutral-800">
                  {entry.toolName ?? entry.label ?? "System"}
                </div>
                <div className="text-xs text-neutral-400">
                  {new Date(entry.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-xs text-neutral-700">
              {formatPayload(entry.payload)}
            </pre>
          </Card>
        ))}
      </div>
    </div>
  );
}
