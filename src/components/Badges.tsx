import { cn } from "@/lib/utils";

type BadgeProps = {
  label: string;
  variant?: "neutral" | "success" | "warning" | "danger" | "info";
  className?: string;
};

export function Badge({ label, variant = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        {
          "border-neutral-200 bg-neutral-100 text-neutral-700":
            variant === "neutral",
          "border-emerald-200 bg-emerald-100 text-emerald-700":
            variant === "success",
          "border-amber-200 bg-amber-100 text-amber-700":
            variant === "warning",
          "border-red-200 bg-red-100 text-red-700": variant === "danger",
          "border-blue-200 bg-blue-100 text-blue-700": variant === "info"
        },
        className
      )}
    >
      {label}
    </span>
  );
}

export function ActionBadge({ action }: { action?: string }) {
  const normalized = action ?? "HOLD";
  const variant =
    normalized === "BUY_YES"
      ? "success"
      : normalized === "BUY_NO"
        ? "danger"
        : normalized === "EXIT"
          ? "warning"
          : normalized === "FLIP"
            ? "info"
            : "neutral";

  return <Badge label={normalized} variant={variant} />;
}

export function ConfidenceBadge({ confidence }: { confidence?: number }) {
  const value = typeof confidence === "number" ? confidence : 0;
  const label =
    value >= 0.7 ? "High" : value >= 0.4 ? "Medium" : "Low";
  const variant =
    value >= 0.7 ? "success" : value >= 0.4 ? "warning" : "danger";
  return <Badge label={`Confidence ${label}`} variant={variant} />;
}
