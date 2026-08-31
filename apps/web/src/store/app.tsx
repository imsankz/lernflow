import * as React from "react";

import type { DeckMeta, Settings } from "@/store/storage";

export interface DeckWithCards extends DeckMeta {
  newCount: number;
  dueCount: number;
  totalCount: number;
}

interface AppState {
  decks: DeckMeta[];
  cards: CardView[];
  settings: Settings;
  streakDays: string[];
}

export interface CardView {
  id: string;
  deckId: string;
  rowIndex: number;
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview?: number;
}

interface AppContextValue extends AppState {
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  importDeck: (name: string, rows: import("@/store/storage").DeckRowStored[]) => Promise<DeckMeta>;
  deleteDeck: (id: string) => Promise<void>;
  setCards: (cards: CardView[]) => void;
}

const AppContext = React.createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AppState>({ decks: [], cards: [], settings: { dailyGoal: 40 }, streakDays: [] });

  const refresh = React.useCallback(async () => {
    const { loadDecks, loadCards, loadSettings, loadStreak } = await import("@/store/storage");
    const decks = await loadDecks();
    const settings = await loadSettings();
    const streak = await loadStreak();
    const cards = await loadCards(decks.map((d) => d.id));
    setState((prev) => ({ ...prev, decks, cards, settings, streakDays: streak.activeDays }));
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateSettings = React.useCallback(
    async (patch: Partial<Settings>) => {
      const { saveSettings } = await import("@/store/storage");
      const next = { ...state.settings, ...patch };
      setState((prev) => ({ ...prev, settings: next }));
      await saveSettings(next);
    },
    [state.settings],
  );

  const importDeck = React.useCallback(
    async (name: string, rows: import("@/store/storage").DeckRowStored[]) => {
      const { importDeck: doImport } = await import("@/store/storage");
      const meta = await doImport(name, rows);
      await refresh();
      return meta;
    },
    [refresh],
  );

  const deleteDeck = React.useCallback(
    async (id: string) => {
      const { deleteDeck: doDelete } = await import("@/store/storage");
      await doDelete(id);
      await refresh();
    },
    [refresh],
  );

  const setCards = React.useCallback((cards: CardView[]) => {
    setState((prev) => ({ ...prev, cards }));
  }, []);

  const value = React.useMemo<AppContextValue>(
    () => ({ ...state, refresh, updateSettings, importDeck, deleteDeck, setCards }),
    [state, refresh, updateSettings, importDeck, deleteDeck, setCards],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
