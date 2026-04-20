export type Action = "BUY_YES" | "BUY_NO" | "HOLD" | "EXIT" | "FLIP";

export interface Recommendation {
  action: Action;
  edge: number;
  threshold: number;
  confidence: number;
  size: "SMALL" | "MEDIUM" | "LARGE" | null;
  reasoning: string[];
}

export type Position = "YES" | "NO" | "NONE";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeEntryThreshold(
  confidence: number,
  liquidity: number,
  daysToResolution: number,
  base = 0.07
): number {
  const conf = clamp(confidence, 0, 1);
  const liq = clamp(liquidity, 0, 1);
  const timeFactor = clamp((daysToResolution - 30) / 90, 0, 1);
  return base + 0.04 * (1 - conf) + 0.03 * (1 - liq) + 0.02 * timeFactor;
}

function pickSize(
  edgeAbs: number,
  threshold: number
): "SMALL" | "MEDIUM" | "LARGE" {
  if (edgeAbs >= threshold * 2) return "LARGE";
  if (edgeAbs >= threshold * 1.5) return "MEDIUM";
  return "SMALL";
}

export function makeRecommendation(
  pAgent: number,
  pMarket: number,
  confidence: number,
  liquidity: number,
  daysToResolution: number,
  currentPosition: Position,
  maxBet: number
): Recommendation {
  const pAgentClamped = clamp(pAgent, 0, 1);
  const pMarketClamped = clamp(pMarket, 0, 1);
  const conf = clamp(confidence, 0, 1);
  const threshold = computeEntryThreshold(conf, liquidity, daysToResolution);
  const edge = pAgentClamped - pMarketClamped;

  let action: Action = "HOLD";

  if (currentPosition === "NONE") {
    if (edge >= threshold) action = "BUY_YES";
    else if (edge <= -threshold) action = "BUY_NO";
  } else if (currentPosition === "YES") {
    if (edge <= -threshold) action = "FLIP";
    else if (edge <= threshold * 0.5) action = "EXIT";
  } else if (currentPosition === "NO") {
    if (edge >= threshold) action = "FLIP";
    else if (edge >= -threshold * 0.5) action = "EXIT";
  }

  const edgeAbs = Math.abs(edge);
  const size =
    action === "BUY_YES" || action === "BUY_NO" || action === "FLIP"
      ? pickSize(edgeAbs, threshold)
      : null;

  const reasoning = [
    `p_agent=${pAgentClamped.toFixed(3)}, p_market=${pMarketClamped.toFixed(3)}, edge=${edge.toFixed(3)}`,
    `threshold=${threshold.toFixed(3)} (confidence=${conf.toFixed(2)}, liquidity=${clamp(liquidity, 0, 1).toFixed(2)}, days=${daysToResolution})`,
    `position=${currentPosition}`
  ];

  if (size) {
    reasoning.push(`size=${size} (maxBet=${maxBet})`);
  }

  return {
    action,
    edge,
    threshold,
    confidence: conf,
    size,
    reasoning
  };
}
