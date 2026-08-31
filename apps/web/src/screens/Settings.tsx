import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/store/app";

export default function SettingsScreen({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }) {
  const { settings, updateSettings } = useApp();
  const [goal, setGoal] = useState(String(settings.dailyGoal));
  const [examDate, setExamDate] = useState(settings.examDate ?? "");
  const [base, setBase] = useState(settings.openaiBase ?? "");
  const [key, setKey] = useState(settings.openaiKey ?? "");
  const [model, setModel] = useState(settings.openaiModel ?? "");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await updateSettings({
      dailyGoal: Math.max(1, Math.min(200, parseInt(goal, 10) || 40)),
      examDate: examDate || undefined,
      openaiBase: base.trim() || undefined,
      openaiKey: key.trim() || undefined,
      openaiModel: model.trim() || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Stored locally — nothing leaves this device except your Ask requests</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Study</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="goal">New cards per day</Label>
            <Input id="goal" type="number" min={1} max={200} value={goal} onChange={(e) => setGoal(e.target.value)} className="sm:max-w-[160px]" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exam">Exam date (countdown on Today)</Label>
            <Input id="exam" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} className="sm:max-w-[220px]" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Ask — AI tutor</CardTitle>
          <CardDescription>
            Optional OpenAI-compatible endpoint for the free-text “Ask” check on review cards. Leave empty to hide it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="base">Base URL</Label>
            <Input id="base" placeholder="https://api.openai.com/v1" value={base} onChange={(e) => setBase(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="key">API key</Label>
            <Input id="key" type="password" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="model">Model</Label>
            <Input id="model" placeholder="gpt-4o-mini" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onToggleDark}>
            {dark ? "Switch to light" : "Switch to dark"}
          </Button>
        </CardContent>
      </Card>

      <Button onClick={() => void save()} className="w-full sm:w-auto">
        {saved ? "Saved ✓" : "Save settings"}
      </Button>
    </div>
  );
}
