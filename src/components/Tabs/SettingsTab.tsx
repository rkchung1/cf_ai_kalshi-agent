import { useState } from "react";
import { Card } from "@/components/card/Card";
import { Input } from "@/components/input/Input";
import { Select } from "@/components/select/Select";
import { Button } from "@/components/button/Button";
import { useAppState } from "@/context/AppStateContext";

export function SettingsTab() {
  const { settings, setSettings, runTool } = useAppState();
  const [saving, setSaving] = useState(false);
  const [thresholdInput, setThresholdInput] = useState(settings.alertThreshold);

  const handleSave = async () => {
    setSaving(true);
    await runTool("setAlertThreshold", { delta: thresholdInput });
    setSettings({ ...settings, alertThreshold: thresholdInput });
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-white">
        <h2 className="text-lg font-semibold text-neutral-900">Settings</h2>
        <p className="text-sm text-neutral-500">
          Configure default sizing, alert sensitivity, and scheduling preferences.
        </p>
      </Card>

      <Card className="bg-white space-y-4">
        <div>
          <div className="text-xs uppercase text-neutral-400">Default Max Bet</div>
          <Input
            type="number"
            min={1}
            initialValue={String(settings.maxBet)}
            onValueChange={(value) =>
              setSettings({ ...settings, maxBet: Number(value) })
            }
            className="w-full"
          />
        </div>

        <div>
          <div className="text-xs uppercase text-neutral-400">Alert Threshold</div>
          <Input
            type="number"
            step="0.01"
            initialValue={String(thresholdInput)}
            onValueChange={(value) => setThresholdInput(Number(value))}
            className="w-full"
          />
        </div>

        <div>
          <div className="text-xs uppercase text-neutral-400">Risk Mode</div>
          <Select
            options={[
              { value: "Conservative" },
              { value: "Balanced" },
              { value: "Aggressive" }
            ]}
            value={settings.riskMode}
            setValue={(value) =>
              setSettings({
                ...settings,
                riskMode: value as "Conservative" | "Balanced" | "Aggressive"
              })
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm text-neutral-500">
            Alert threshold will be applied to watchlist checks.
          </div>
          <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
            Apply Settings
          </Button>
        </div>
      </Card>

      <Card className="bg-white">
        <div className="text-xs uppercase text-neutral-400">Scheduling</div>
        <p className="mt-2 text-sm text-neutral-500">
          Scheduled checks: {settings.scheduled ? "Enabled" : "Disabled"} •
          Frequency: every {settings.frequencyMinutes} minutes
        </p>
      </Card>
    </div>
  );
}
