export type EventStatus = "DRAFT" | "PUBLISHED" | "CANCELLED" | "ARCHIVED";
export type EventLifecycle = "UPCOMING" | "IN_PROGRESS" | "PAST" | "UNKNOWN";
export type EventFormat = "PHYSICAL" | "ONLINE" | "HYBRID";

export interface SiteEventRecord {
  id: string;
  site: number;
  site_code?: string | null;
  title: string;
  slug: string;
  summary: string;
  description: string;
  category: string | null;
  category_name?: string | null;
  organizer_name: string;
  organizer_email?: string;
  organizer_phone?: string;
  status: EventStatus;
  lifecycle: EventLifecycle;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  venue: string;
  format: EventFormat;
  online_url: string;
  banner_asset: string | null;
  banner_url: string | null;
  registration_required: boolean;
  registration_capacity: number | null;
  registration_open: boolean;
  accepts_registration: boolean;
  cancellation_notice: string;
  published_at: string | null;
  cancelled_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  preview?: boolean;
}

export type SiteEventInput = Partial<
  Pick<
    SiteEventRecord,
    | "title"
    | "slug"
    | "summary"
    | "description"
    | "category"
    | "organizer_name"
    | "organizer_email"
    | "organizer_phone"
    | "starts_at"
    | "ends_at"
    | "timezone"
    | "venue"
    | "format"
    | "online_url"
    | "banner_asset"
    | "registration_required"
    | "registration_capacity"
  >
>;

export function emptyEventInput(): SiteEventInput {
  return {
    title: "",
    slug: "",
    summary: "",
    description: "",
    category: null,
    organizer_name: "",
    organizer_email: "",
    organizer_phone: "",
    starts_at: null,
    ends_at: null,
    timezone: "Africa/Addis_Ababa",
    venue: "",
    format: "PHYSICAL",
    online_url: "",
    banner_asset: null,
    registration_required: false,
    registration_capacity: null,
  };
}
