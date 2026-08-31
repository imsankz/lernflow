export const REVIEW_KEYS = ["1", "2", "3", "4"];
export const RATING_LABELS: Record<number, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

export const KEY_TO_RATING: Record<string, number> = { "1": 1, "2": 2, "3": 3, "4": 4 };

export const RATING_COLORS: Record<number, string> = {
  1: "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25",
  2: "bg-orange-500/15 text-orange-400 border-orange-500/30 hover:bg-orange-500/25",
  3: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25",
  4: "bg-sky-500/15 text-sky-400 border-sky-500/30 hover:bg-sky-500/25",
};

export const STATE_LABELS: Record<number, string> = {
  0: "New",
  1: "Learning",
  2: "Review",
  3: "Relearning",
};
