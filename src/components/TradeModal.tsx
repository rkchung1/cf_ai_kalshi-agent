import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modal/Modal";
import { Button } from "@/components/button/Button";
import { Input } from "@/components/input/Input";
import { Select } from "@/components/select/Select";
import type { MarketSnapshot } from "@/context/AppStateContext";

export function TradeModal({
  isOpen,
  onClose,
  snapshot,
  defaultSide = "YES",
  defaultSize = 10,
  onSubmit
}: {
  isOpen: boolean;
  onClose: () => void;
  snapshot?: MarketSnapshot;
  defaultSide?: "YES" | "NO";
  defaultSize?: number;
  onSubmit: (payload: { side: "YES" | "NO"; size: number; price: number }) => void;
}) {
  const [side, setSide] = useState<"YES" | "NO">(defaultSide);
  const [size, setSize] = useState(defaultSize);

  useEffect(() => {
    if (isOpen) {
      setSide(defaultSide);
      setSize(defaultSize);
    }
  }, [isOpen, defaultSide, defaultSize]);
  const price = useMemo(() => {
    const yesPrice = typeof snapshot?.yesPrice === "number" ? snapshot.yesPrice : 0;
    const noPrice = typeof snapshot?.noPrice === "number" ? snapshot.noPrice : 0;
    return side === "YES" ? yesPrice : noPrice;
  }, [snapshot, side]);

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-neutral-900">Log Paper Trade</h3>
          <p className="text-sm text-neutral-500">
            Record a simulated trade for {snapshot?.ticker ?? "this market"}.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase text-neutral-400">Side</div>
            <Select
              options={[{ value: "YES" }, { value: "NO" }]}
              value={side}
              setValue={(value) => setSide(value as "YES" | "NO")}
            />
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-400">Size</div>
            <Input
              type="number"
              initialValue={String(size)}
              onValueChange={(value) => setSize(Number(value))}
              min={1}
              className="w-full"
            />
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-400">Price</div>
            <Input
              type="number"
              initialValue={price.toString()}
              onValueChange={() => {}}
              className="w-full"
              disabled
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} size="sm">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onSubmit({ side, size, price });
              onClose();
            }}
          >
            Log Trade
          </Button>
        </div>
      </div>
    </Modal>
  );
}
