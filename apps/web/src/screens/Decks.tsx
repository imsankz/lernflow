import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { parseDeckFile } from "@/lib/parse";
import { useApp } from "@/store/app";

export default function DecksScreen() {
  const { decks, cards, importDeck, deleteDeck } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const parsed = await parseDeckFile(file, name.trim() || undefined);
        if (parsed.rows.length === 0) throw new Error("no usable rows in file");
        const meta = await importDeck(parsed.name, parsed.rows);
        setMessage(`Imported “${parsed.name}” — ${meta.rowCount} notes`);
        setName("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [importDeck, name],
  );

  const BUNDLED = [
    { id: "goethe-a1", label: "Goethe A1 Wortliste", file: "/decks/goethe-a1.json" },
    { id: "goethe-a2", label: "Goethe A2 Wortliste", file: "/decks/goethe-a2.json" },
    { id: "goethe-b1", label: "Goethe B1 Wortliste", file: "/decks/goethe-b1.json" },
  ];

  const importBundledDeck = useCallback(
    async (label: string, file: string) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch(file);
        if (!res.ok) throw new Error(`failed to load bundled deck (${res.status})`);
        const raw = (await res.json()) as {
          lemma: string; gender: string; translation?: string; forms?: string;
          example?: string; examples?: string;
        }[];
        const rows = raw.map((r) => ({
          lemma: r.lemma,
          gender: r.gender ?? "",
          translation: r.translation ?? "",
          forms: r.forms ?? "",
          example: (r.example ?? r.examples ?? "").split("\n")[0].replace(/^\s*\d+\.\s*/, "").trim(),
          audio: undefined as string | undefined,
        }));
        const meta = await importDeck(label, rows);
        setMessage(`Imported ${label} — ${meta.rowCount} notes`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [importDeck],
  );

  const counts = useCallback(
    (deckId: string) => {
      const total = cards.filter((c) => c.deckId === deckId).length;
      return total;
    },
    [cards],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Decks</h1>
          <p className="text-sm text-muted-foreground">Import rows.json or Anki TSV files — everything stays on this device</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Import</CardTitle>
          <CardDescription>rows.json ({`[{lemma, gender, translation, forms, example, pos?, audio?}]`}) or Anki TSV with a #separator:tab header</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Deck name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="sm:max-w-xs"
            />
            <div className="flex flex-1 gap-2">
              <Button onClick={() => fileRef.current?.click()} disabled={busy} className="flex-1">
                Choose file…
              </Button>
              <input ref={fileRef} type="file" accept=".json,.tsv,.txt" className="hidden" onChange={(e) => void onFile(e)} />
              {BUNDLED.map((b) => (
                <Button key={b.id} variant="outline" onClick={() => void importBundledDeck(b.label, b.file)} disabled={busy}>
                  {b.label.split(" ")[1]}
                </Button>
              ))}
            </div>
          </div>
          {busy && <p className="text-xs text-muted-foreground">Importing…</p>}
          {message && <p className="text-xs text-emerald-400">{message}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Your decks</CardTitle>
          <CardDescription>{decks.length} deck{decks.length === 1 ? "" : "s"} · {cards.length} cards in rotation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {decks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No decks yet. <Link className="text-primary underline" to="/decks">Import the bundled Goethe B1</Link> or add your own.
            </p>
          )}
          {decks.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-muted-foreground">
                  {d.rowCount} notes · {counts(d.id)} cards created · imported{" "}
                  {new Date(d.importedAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-red-400"
                onClick={() => {
                  if (window.confirm(`Delete “${d.name}” and all its cards?`)) void deleteDeck(d.id);
                }}
              >
                Delete
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Format reference: <code className="rounded bg-muted px-1">rows.json</code> — array of objects with lemma, gender, translation, forms, example (pos and audio optional). TSV uses the <code className="rounded bg-muted px-1">#separator:tab</code> header from the lernflow pipeline.
      </p>
    </div>
  );
}
