/**
 * Mock fixtures for the Sites screen.
 *
 * These follow the PROVISIONAL `Site` DTO in @uog/types (the backend has no
 * Sites API yet). They are fixtures for local development only — the live
 * adapter never returns them, so nothing here can be mistaken for real data
 * in a deployed integration.
 */
import type { Site } from "@uog/types";

export const siteFixtures: Site[] = [
  {
    id: 1,
    name: "University Main Site",
    slug: "main",
    organization: 1,
    status: "PUBLISHED",
    domains: ["www.uog.edu.et", "uog.edu.et"],
    created_at: "2026-10-24T09:53:38.350000Z",
    updated_at: "2026-10-24T09:53:38.350000Z",
  },
  {
    id: 2,
    name: "College of Informatics",
    slug: "informatics",
    organization: 2,
    status: "PUBLISHED",
    domains: ["informatics.uog.edu.et"],
    created_at: "2026-10-24T09:53:38.362935Z",
    updated_at: "2026-10-24T09:53:38.362945Z",
  },
  {
    id: 3,
    name: "Research Portal",
    slug: "research",
    organization: 1,
    status: "DRAFT",
    domains: [],
    created_at: "2026-10-24T09:53:38.376256Z",
    updated_at: "2026-10-24T09:53:38.376266Z",
  },
];
