import { Card } from "@/components/card/Card";
import { useAppState } from "@/context/AppStateContext";

export function JournalTab() {
  const { postMortems } = useAppState();

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-white">
        <h2 className="text-lg font-semibold text-neutral-900">Post-Mortems</h2>
        <p className="text-sm text-neutral-500">
          Review outcomes and lessons from resolved markets.
        </p>
      </Card>

      <Card className="bg-white">
        {postMortems.length === 0 && (
          <p className="text-sm text-neutral-500">
            No post-mortems generated yet.
          </p>
        )}
        <div className="space-y-4 text-sm text-neutral-600">
          {postMortems.map((entry) => (
            <div
              key={`${entry.ticker}-${entry.generatedAt}`}
              className="border-b border-neutral-100 pb-4 last:border-0"
            >
              <div className="flex items-center gap-3">
                <div className="font-semibold text-neutral-800">{entry.ticker}</div>
                <div className="text-xs uppercase text-neutral-400">
                  Outcome {entry.outcome}
                </div>
                <div className="text-xs text-neutral-400">
                  {entry.generatedAt
                    ? new Date(entry.generatedAt).toLocaleString()
                    : ""}
                </div>
              </div>
              {entry.summary && <p className="mt-2">{entry.summary}</p>}
              {entry.lessons?.length ? (
                <div className="mt-2">
                  <div className="text-xs uppercase text-neutral-400">Lessons</div>
                  <ul className="list-disc pl-5">
                    {entry.lessons.map((lesson, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                      <li key={index}>{lesson}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {entry.improvements?.length ? (
                <div className="mt-2">
                  <div className="text-xs uppercase text-neutral-400">
                    Improvements
                  </div>
                  <ul className="list-disc pl-5">
                    {entry.improvements.map((item, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
