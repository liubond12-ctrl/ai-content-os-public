export type CreatorArea = "today" | "writing" | "materials" | "system";
export type CreatorShortcut = {
  href: string;
  label: string;
};
export type CreatorSection = CreatorShortcut & {
  id: CreatorArea;
  icon: "home" | "doc" | "book" | "settings";
};
export type ReviewAttention = "normal" | "clear" | "risk" | "conflict";
export type SavedPassage = {
  field: "title" | "body";
  offset: number;
  quote: string;
  previous: string;
  block?: number;
  height?: number;
};
export type PendingDismissal = {
  key: string;
  deadline: number;
};
