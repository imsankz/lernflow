import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ttsSupported } from "@/lib/tts";
import { useApp } from "@/store/app";
import { downloadBackup, exportBackup, importBackup, parseBackup } from "@/store/backup";

export default function SettingsScreen({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }) {
  const { settings, updateSettings, refresh } = useApp();
  const [goal, setGoal] = useState(String(settings.dailyGoal));
  const [examDate, setExamDate] = useState(settings.examDate ?? "");
  const [base, setBase] = useState(settings.openaiBase ?? "");
  const [key, setKey] = useState(settings.openaiKey ?? "");
  const [model, setModel] = useState(settings.openaiModel ?? "");
  const [saved, setSaved] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);

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

  const doExport = async () => {
    setBackupBusy(true);
    setBackupError(null);
    setBackupMessage(null);
    try {
      const backup = await exportBackup();
      downloadBackup(backup);
      setBackupMessage(`Exported ${Object.keys(backup.data).length} record(s)`);
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackupBusy(false);
    }
  };

  const doImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupBusy(true);
    setBackupError(null);
    setBackupMessage(null);
    try {
      const text = await file.text();
      const backup = parseBackup(text);
      if (!window.confirm(`Import backup from ${backup.exportedAt || "unknown date"}? This replaces all decks, cards, and settings on this device.`)) {
        return;
      }
      const n = await importBackup(backup, { mode: "replace" });
      await refresh();
      setBackupMessage(`Imported ${n} record(s) — reload to see everything`);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackupBusy(false);
      if (backupFileRef.current) backupFileRef.current.value = "";
    }
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
          <CardTitle className="text-lg">Audio</CardTitle>
          <CardDescription>
            {ttsSupported()
              ? "German words are spoken with your device's built-in text-to-speech — no audio files, no network."
              : "This browser doesn't support SpeechSynthesis — audio is unavailable."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.ttsEnabled ?? true}
              onChange={(e) => void updateSettings({ ttsEnabled: e.target.checked })}
              disabled={!ttsSupported()}
            />
            Enable spoken German on review cards
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.ttsAutoplay ?? false}
              onChange={(e) => void updateSettings({ ttsAutoplay: e.target.checked })}
              disabled={!ttsSupported() || !(settings.ttsEnabled ?? true)}
            />
            Speak automatically when a card appears
          </label>
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
          <CardTitle className="text-lg">Backup</CardTitle>
          <CardDescription>Export everything (decks, cards, review history, settings) to one JSON file, or restore from one.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => void doExport()} disabled={backupBusy} className="flex-1">
              Export backup
            </Button>
            <Button variant="outline" onClick={() => backupFileRef.current?.click()} disabled={backupBusy} className="flex-1">
              Import backup…
            </Button>
            <input ref={backupFileRef} type="file" accept=".json" className="hidden" onChange={(e) => void doImport(e)} />
          </div>
          {backupBusy && <p className="text-xs text-muted-foreground">Working…</p>}
          {backupMessage && <p className="text-xs text-emerald-400">{backupMessage}</p>}
          {backupError && <p className="text-xs text-red-400">{backupError}</p>}
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
