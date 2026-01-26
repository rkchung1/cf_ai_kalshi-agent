export type Claim = {
  text: string;
  polarity: "YES" | "NO" | "NEUTRAL";
  source: string;
  is_numeric: boolean;
  recency_hours: number;
  reliability: number;
};

export type ConfidenceResult = {
  confidence: number;
  breakdown: {
    recencyScore: number;
    sourceQualityScore: number;
    multiplicityScore: number;
    specificityScore: number;
    timeFactorScore: number;
  };
  details: {
    numClaims: number;
    distinctSources: number;
    avgRecencyHours: number;
    numericClaimRate: number;
    daysToResolution: number;
  };
};

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function computeAgentProbability(pMarket: number, delta: number): number {
  return clamp01(pMarket + delta);
}

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function computeConfidence(
  claims: Claim[],
  daysToResolution: number
): ConfidenceResult {
  const numClaims = claims.length;
  const recencyScoreRaw =
    numClaims === 0
      ? 0
      : claims.reduce((sum, claim) => {
          const recency = Math.max(0, safeNumber(claim.recency_hours, 0));
          return sum + Math.exp(-recency / 72);
        }, 0) / numClaims;
  const recencyScore = clamp01(recencyScoreRaw);

  const sourceQualityRaw =
    numClaims === 0
      ? 0
      : claims.reduce((sum, claim) => {
          const reliability = clamp01(safeNumber(claim.reliability, 0));
          return sum + reliability;
        }, 0) / numClaims;
  const sourceQualityScore = clamp01(sourceQualityRaw);

  const sources = new Set(
    claims
      .map((claim) => claim.source?.trim())
      .filter((source): source is string => Boolean(source))
  );
  const distinctSources = sources.size;
  const multiplicityBase =
    distinctSources > 0 ? distinctSources : numClaims > 0 ? 1 : 0;
  const multiplicityScore = clamp01(multiplicityBase / 4);

  const numericClaims = claims.filter((claim) => claim.is_numeric).length;
  const numericClaimRate = numericClaims / Math.max(1, numClaims);
  const specificityScore = clamp01(numericClaimRate);

  const timePenalty =
    clamp01((safeNumber(daysToResolution, 0) - 30) / 180) * 0.4;
  const timeFactorScore = clamp01(1 - timePenalty);

  const confidence = clamp01(
    0.25 * recencyScore +
      0.25 * sourceQualityScore +
      0.2 * multiplicityScore +
      0.15 * specificityScore +
      0.15 * timeFactorScore
  );

  const avgRecencyHours =
    numClaims === 0
      ? 0
      : claims.reduce(
          (sum, claim) => sum + Math.max(0, safeNumber(claim.recency_hours, 0)),
          0
        ) / numClaims;

  return {
    confidence,
    breakdown: {
      recencyScore,
      sourceQualityScore,
      multiplicityScore,
      specificityScore,
      timeFactorScore
    },
    details: {
      numClaims,
      distinctSources,
      avgRecencyHours,
      numericClaimRate,
      daysToResolution: safeNumber(daysToResolution, 0)
    }
  };
}

let didRunChecks = false;

export function runScoringSanityChecks(): void {
  if (didRunChecks) return;
  didRunChecks = true;

  const sampleClaims: Claim[] = [
    {
      text: "Sample numeric claim",
      polarity: "YES",
      is_numeric: true,
      recency_hours: 6,
      reliability: 0.9,
      source: "data-feed"
    },
    {
      text: "Sample news claim",
      polarity: "NEUTRAL",
      is_numeric: false,
      recency_hours: 24,
      reliability: 0.7,
      source: "newswire"
    }
  ];

  const lowClaims: Claim[] = [
    {
      text: "Old rumor",
      polarity: "NO",
      is_numeric: false,
      recency_hours: 200,
      reliability: 0.2,
      source: ""
    }
  ];

  const higher = computeConfidence(sampleClaims, 10).confidence;
  const lower = computeConfidence(lowClaims, 200).confidence;

  if (higher < lower) {
    console.warn(
      "[scoring] Sanity check failed: expected higher confidence with fresher, higher-quality claims."
    );
  }

  const prob = computeAgentProbability(0.6, 0.3);
  if (prob < 0 || prob > 1) {
    console.warn("[scoring] Sanity check failed: p_agent out of bounds.");
  }
}
