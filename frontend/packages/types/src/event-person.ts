export type PersonVisibility = "PUBLIC" | "HIDDEN";
export type SessionPersonRole = "SPEAKER" | "MODERATOR" | "PANELIST" | "ORGANIZER";

export interface EventPersonLink {
  label: string;
  url: string;
}

export interface EventPersonRecord {
  id: string;
  event: string;
  display_name: string;
  affiliation: string;
  biography: string;
  profile_photo: string | null;
  profile_photo_url?: string | null;
  public_links: EventPersonLink[];
  visibility: PersonVisibility;
  private_email: string;
  private_phone: string;
  verified_account?: number | null;
  sort_order: number;
  version: number;
  updated_at: string;
  created_at?: string;
  removed_at?: string | null;
}

export type EventPersonInput = Partial<
  Pick<
    EventPersonRecord,
    | "display_name"
    | "affiliation"
    | "biography"
    | "profile_photo"
    | "public_links"
    | "visibility"
    | "private_email"
    | "private_phone"
    | "verified_account"
    | "sort_order"
  >
>;

export interface SessionPersonAssignment {
  id: string;
  session: string;
  person: string;
  role: SessionPersonRole;
  sort_order: number;
  person_summary?: Partial<EventPersonRecord> & {
    display_name?: string;
    affiliation?: string;
    profile_photo_url?: string | null;
    public_links?: EventPersonLink[];
  };
  updated_at?: string;
}

export function emptyPersonInput(): EventPersonInput {
  return {
    display_name: "",
    affiliation: "",
    biography: "",
    profile_photo: null,
    public_links: [],
    visibility: "PUBLIC",
    private_email: "",
    private_phone: "",
  };
}
