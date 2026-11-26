export type CreatorArea = "today" | "writing" | "history" | "discovery" | "materials" | "system";
export type CreatorPrimaryArea = Exclude<CreatorArea,"system">;
export type CreatorShortcut = {
  href: string;
  label: string;
};
export type CreatorSection = CreatorShortcut & {
  id: CreatorPrimaryArea;
  icon: "home" | "doc" | "book" | "hot";
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
