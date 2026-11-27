export type SessionStatus = "SCHEDULED" | "UPDATED" | "CANCELLED" | "COMPLETED";
export type SessionVisibility = "PUBLIC" | "HIDDEN";
export type SessionType = "KEYNOTE" | "PANEL" | "WORKSHOP" | "BREAK" | "OTHER";

export interface EventSessionRecord {
  id: string;
  event: string;
  day_date: string | null;
  starts_at: string;
  ends_at: string;
  title: string;
  description: string;
  session_type: SessionType;
  venue_room: string;
  track: string;
  sort_order: number;
  visibility: SessionVisibility;
  status: SessionStatus;
  public_notes: string;
  speaker_labels: string[];
  media_asset?: string | null;
  document?: string | null;
  version: number;
  updated_at: string;
  created_at?: string;
  removed_at?: string | null;
  conflicts?: {
    room_conflicts?: Array<Record<string, unknown>>;
    speaker_warnings?: Array<Record<string, unknown>>;
  };
}

export type EventSessionInput = Partial<
  Pick<
    EventSessionRecord,
    | "title"
    | "description"
    | "session_type"
    | "venue_room"
    | "track"
    | "starts_at"
    | "ends_at"
    | "day_date"
    | "visibility"
    | "status"
    | "public_notes"
    | "speaker_labels"
    | "media_asset"
    | "document"
    | "sort_order"
  >
>;

export interface EventSessionListResult {
  results: EventSessionRecord[];
  conflicts: {
    room_conflicts: Array<Record<string, unknown>>;
    speaker_warnings: Array<Record<string, unknown>>;
  };
}

export function emptySessionInput(): EventSessionInput {
  return {
    title: "",
    description: "",
    session_type: "OTHER",
    venue_room: "",
    track: "",
    visibility: "PUBLIC",
    status: "SCHEDULED",
    public_notes: "",
    speaker_labels: [],
  };
}
