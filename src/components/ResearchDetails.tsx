import { Card } from "@/components/card/Card";
import { Button } from "@/components/button/Button";
import { ActionBadge, ConfidenceBadge } from "@/components/Badges";
import type { MarketSnapshot, ResearchResult, RecommendationResult } from "@/context/AppStateContext";

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatNumber = (value?: number, digits = 2) => {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
};

export function ResearchDetails({
  snapshot,
  research,
  recommendation,
  onAddWatchlist,
  onLogTrade,
  onRecommend,
  loading
}: {
  snapshot?: MarketSnapshot;
  research?: ResearchResult;
  recommendation?: RecommendationResult;
  onAddWatchlist?: () => void;
  onLogTrade?: () => void;
  onRecommend?: () => void;
  loading?: boolean;
}) {
  if (!snapshot && !research && !recommendation) {
    return (
      <div className="text-sm text-neutral-500">
        Select a market to view details.
      </div>
    );
  }

  const title = snapshot?.title || research?.snapshot?.title || "Market";
  const ticker =
    snapshot?.ticker || research?.snapshot?.ticker || recommendation?.ticker;
  const confidenceValue =
    research?.confidence ?? recommendation?.confidence ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-[0.2em] text-neutral-400">
          Research Details
        </div>
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>{ticker}</span>
          {recommendation?.action && <ActionBadge action={recommendation.action} />}
          {confidenceValue !== undefined && (
            <ConfidenceBadge confidence={confidenceValue} />
          )}
        </div>
      </div>

      <Card className="bg-white">
        <h3 className="text-sm font-semibold text-neutral-800">
          Market Snapshot
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-neutral-600">
          <div>
            <div className="text-xs uppercase text-neutral-400">YES</div>
            <div>${formatNumber(snapshot?.yesPrice, 3)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-400">NO</div>
            <div>${formatNumber(snapshot?.noPrice, 3)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-400">Resolution</div>
            <div>{formatDate(snapshot?.resolutionDate)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-400">Category</div>
            <div>{snapshot?.category ?? "—"}</div>
          </div>
        </div>
        {snapshot?.description && (
          <p className="mt-3 text-sm text-neutral-600">{snapshot.description}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {onRecommend && (
            <Button size="sm" variant="primary" onClick={onRecommend} loading={loading}>
              Get Recommendation
            </Button>
          )}
          {onAddWatchlist && (
            <Button size="sm" variant="secondary" onClick={onAddWatchlist}>
              Add to Watchlist
            </Button>
          )}
          {onLogTrade && (
            <Button size="sm" variant="secondary" onClick={onLogTrade}>
              Log Paper Trade
            </Button>
          )}
        </div>
      </Card>

      {recommendation && (
        <Card className="bg-white">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-800">
              Recommendation
            </h3>
            {recommendation.action && <ActionBadge action={recommendation.action} />}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-neutral-600">
            <div>
              <div className="text-xs uppercase text-neutral-400">Edge</div>
              <div>{formatNumber(recommendation.edge, 3)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-neutral-400">Threshold</div>
              <div>{formatNumber(recommendation.threshold, 3)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-neutral-400">Size</div>
              <div>{recommendation.size ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-neutral-400">Confidence</div>
              <div>{formatNumber(recommendation.confidence, 2)}</div>
            </div>
          </div>
          {recommendation.reasoning?.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-600">
              {recommendation.reasoning.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
          {recommendation.scoreExplanationText && (
            <pre className="mt-3 whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-xs text-neutral-600">
              {recommendation.scoreExplanationText}
            </pre>
          )}
        </Card>
      )}

      {research && (
        <>
          <Card className="bg-white">
            <h3 className="text-sm font-semibold text-neutral-800">
              Score Explanation
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-neutral-600">
              <div>
                <div className="text-xs uppercase text-neutral-400">Market prior</div>
                <div>{formatNumber(research.p_market, 3)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-neutral-400">Delta</div>
                <div>{formatNumber(research.delta, 3)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-neutral-400">p_agent</div>
                <div>{formatNumber(research.p_agent, 3)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-neutral-400">Confidence</div>
                <div>{formatNumber(research.confidence, 2)}</div>
              </div>
            </div>
            {research.confidenceBreakdown?.breakdown && (
              <div className="mt-4 text-sm text-neutral-600">
                <div className="text-xs uppercase text-neutral-400">
                  Confidence Breakdown
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>Recency: {formatNumber(research.confidenceBreakdown.breakdown.recencyScore, 2)}</div>
                  <div>Source quality: {formatNumber(research.confidenceBreakdown.breakdown.sourceQualityScore, 2)}</div>
                  <div>Multiplicity: {formatNumber(research.confidenceBreakdown.breakdown.multiplicityScore, 2)}</div>
                  <div>Specificity: {formatNumber(research.confidenceBreakdown.breakdown.specificityScore, 2)}</div>
                  <div>Time factor: {formatNumber(research.confidenceBreakdown.breakdown.timeFactorScore, 2)}</div>
                </div>
              </div>
            )}
            {research.confidenceBreakdown?.details && (
              <div className="mt-4 text-sm text-neutral-600">
                <div className="text-xs uppercase text-neutral-400">
                  Confidence Inputs
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>Claims: {research.confidenceBreakdown.details.numClaims ?? 0}</div>
                  <div>Distinct sources: {research.confidenceBreakdown.details.distinctSources ?? 0}</div>
                  <div>Avg recency (hrs): {formatNumber(research.confidenceBreakdown.details.avgRecencyHours, 1)}</div>
                  <div>Numeric rate: {formatNumber(research.confidenceBreakdown.details.numericClaimRate, 2)}</div>
                  <div>Days to resolution: {research.confidenceBreakdown.details.daysToResolution ?? 0}</div>
                </div>
              </div>
            )}
            {research.scoreExplanationText && (
              <pre className="mt-3 whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-xs text-neutral-600">
                {research.scoreExplanationText}
              </pre>
            )}
          </Card>

          <Card className="bg-white">
            <h3 className="text-sm font-semibold text-neutral-800">Articles Used</h3>
            {research.articles?.length ? (
              <ul className="mt-3 space-y-2 text-sm text-neutral-600">
                {research.articles.map((article, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                  <li key={index} className="border-b border-neutral-100 pb-2 last:border-0">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-neutral-800 hover:underline"
                    >
                      {article.title}
                    </a>
                    <div className="text-xs text-neutral-400">
                      {article.source} • {formatDate(article.publishedAt)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-neutral-500">No articles available.</p>
            )}
          </Card>

          <Card className="bg-white">
            <h3 className="text-sm font-semibold text-neutral-800">Claims</h3>
            {research.claims?.length ? (
              <ul className="mt-3 space-y-2 text-sm text-neutral-600">
                {research.claims.map((claim, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                  <li key={index}>
                    <span className="font-semibold text-neutral-700">
                      [{claim.polarity}]
                    </span>{" "}
                    {claim.text}{" "}
                    <span className="text-xs text-neutral-400">
                      ({claim.source || "unsourced"})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-neutral-500">No claims available.</p>
            )}
          </Card>

          <Card className="bg-white">
            <h3 className="text-sm font-semibold text-neutral-800">Thesis</h3>
            <div className="mt-3 space-y-3 text-sm text-neutral-600">
              <div>
                <div className="text-xs uppercase text-neutral-400">Bull case</div>
                <ul className="list-disc pl-5">
                  {(research.bull_case ?? []).length ? (
                    (research.bull_case ?? []).map((item, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                      <li key={index}>{item}</li>
                    ))
                  ) : (
                    <li>No data provided.</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="text-xs uppercase text-neutral-400">Bear case</div>
                <ul className="list-disc pl-5">
                  {(research.bear_case ?? []).length ? (
                    (research.bear_case ?? []).map((item, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                      <li key={index}>{item}</li>
                    ))
                  ) : (
                    <li>No data provided.</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="text-xs uppercase text-neutral-400">Base case</div>
                <ul className="list-disc pl-5">
                  {(research.base_case ?? []).length ? (
                    (research.base_case ?? []).map((item, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                      <li key={index}>{item}</li>
                    ))
                  ) : (
                    <li>No data provided.</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="text-xs uppercase text-neutral-400">Key risks</div>
                <ul className="list-disc pl-5">
                  {(research.key_risks ?? []).length ? (
                    (research.key_risks ?? []).map((item, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                      <li key={index}>{item}</li>
                    ))
                  ) : (
                    <li>No data provided.</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="text-xs uppercase text-neutral-400">Invalidators</div>
                <ul className="list-disc pl-5">
                  {(research.invalidators ?? []).length ? (
                    (research.invalidators ?? []).map((item, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable display list
                      <li key={index}>{item}</li>
                    ))
                  ) : (
                    <li>No data provided.</li>
                  )}
                </ul>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
