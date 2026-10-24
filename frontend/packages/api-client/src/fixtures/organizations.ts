/**
 * Mock fixtures for the Organizations screen.
 *
 * Every fixture mirrors a real serialized response from
 * backend/apps/organizations/api/serializers.py::OrganizationSerializer,
 * captured from the live development stack (see
 * docs/architecture/organization-dto.md). Field names, types and the
 * `organization_type` code format are deliberately identical to production
 * payloads so that swapping the mock adapter for the live adapter requires
 * no screen changes.
 *
 * Timestamps are ISO-8601 UTC strings exactly as DRF renders them.
 */
import type { Organization } from "@uog/types";

/**
 * Fixture organizations, shaped as a small institutional tree:
 *
 *   UOG (UNIVERSITY)
 *     ├── INFORMATICS (COLLEGE)
 *     │     └── SOFTWARE_ENG (DEPARTMENT)   [INACTIVE]
 *     └── MEDicine ... (kept small on purpose)
 */
export const organizationFixtures: Organization[] = [
  {
    id: 1,
    code: "UOG",
    name: "University of Gondar",
    short_name: "UoG",
    organization_type: "UNIVERSITY",
    parent: null,
    description: "The University of Gondar.",
    status: "ACTIVE",
    metadata: { established: 1954 },
    created_at: "2026-10-24T09:53:38.350000Z",
    updated_at: "2026-10-24T09:53:38.350000Z",
  },
  {
    id: 2,
    code: "INFORMATICS",
    name: "College of Informatics",
    short_name: "CoI",
    organization_type: "COLLEGE",
    parent: 1,
    description: "Computing college.",
    status: "ACTIVE",
    metadata: {},
    created_at: "2026-10-24T09:53:38.362935Z",
    updated_at: "2026-10-24T09:53:38.362945Z",
  },
  {
    id: 3,
    code: "SOFTWARE_ENG",
    name: "Software Engineering Department",
    short_name: "",
    organization_type: "DEPARTMENT",
    parent: 2,
    description: "",
    status: "INACTIVE",
    metadata: { keywords: ["software", "engineering"] },
    created_at: "2026-10-24T09:53:38.376256Z",
    updated_at: "2026-10-24T09:53:38.376266Z",
  },
  {
    id: 4,
    code: "MEDICINE",
    name: "College of Medicine and Health Sciences",
    short_name: "CMHS",
    organization_type: "COLLEGE",
    parent: 1,
    description: "Medical college.",
    status: "ARCHIVED",
    metadata: {},
    created_at: "2026-10-24T09:53:38.390000Z",
    updated_at: "2026-10-24T09:53:38.390000Z",
  },
];

/**
 * A standalone fixture with no parent, used to prove root filtering
 * (`parent=null`) works without relying on the whole tree.
 */
export const rootOrganizationFixture: Organization = organizationFixtures[0];
