"use server";

/**
 * Central module management reads and the confirmed bulk operation.
 *
 * The access token stays server-side. Django enforces the platform-admin
 * permission, eligibility, the development write gate and the stale-preview
 * check; their answers are returned verbatim as clone-safe results.
 */
import { createApiClient } from "@uog/api-client";
import type { PaginatedResponse, PlatformModule } from "@uog/types";

import { getAccessToken } from "@/access-token";
import type {
  ApplyRequest,
  ApplyResult,
  ModuleActivationSummary,
  ModuleOperation,
  ModuleOperationDetail,
  OperationListQuery,
  OperationPreview,
  PreviewRequest,
  SiteActivationRow,
  SiteFilters,
} from "@/modules/bulk-contract";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";

const APPLY_TIMEOUT_MS = 60_000;

export async function setPlatformModuleAvailability(
  id: number, isEnabled: boolean, expectedUpdatedAt: string,
): Promise<ActionResult<PlatformModule>> {
  return attempt(async () => {
    const api = await client();
    const path = `/v1/modules/${encodeURIComponent(id)}/`;
    const current = await api.getDetailed<PlatformModule>(path);
    if (current.data.updated_at !== expectedUpdatedAt) {
      throw new Error("This module changed. Refresh the registry and try again.");
    }
    if (!current.etag) throw new Error("The module version could not be verified. Refresh and try again.");
    return (await api.patchDetailed<PlatformModule>(path, { is_enabled: isEnabled }, { ifMatch: current.etag })).data;
  });
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://backend:8000/api";
}

async function client(timeoutMs?: number) {
  const accessToken = await getAccessToken();
  return createApiClient({
    baseUrl: apiBaseUrl(),
    accessToken: accessToken ?? undefined,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

async function attempt<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export async function listModuleActivationSummary(): Promise<ActionResult<ModuleActivationSummary[]>> {
  return attempt(async () => (await client()).get<ModuleActivationSummary[]>("/v1/modules/activation-summary/"));
}

export async function listSiteModuleActivation(
  query: SiteFilters & { page?: number } = {},
): Promise<ActionResult<PaginatedResponse<SiteActivationRow>>> {
  return attempt(async () => (await client()).get<PaginatedResponse<SiteActivationRow>>(`/v1/site-modules/${queryString(query)}`));
}

export async function previewModuleOperation(request: PreviewRequest): Promise<ActionResult<OperationPreview>> {
  return attempt(async () => (await client()).post<OperationPreview>("/v1/site-modules/bulk-preview/", request));
}

export async function applyModuleOperation(request: ApplyRequest): Promise<ActionResult<ApplyResult>> {
  return attempt(async () =>
    (await client(APPLY_TIMEOUT_MS)).post<ApplyResult>(
      "/v1/site-modules/bulk-apply/",
      { preview_token: request.previewToken, reason: request.reason, confirmation: request.confirmation },
      { headers: { "Idempotency-Key": request.idempotencyKey } },
    ),
  );
}

export async function listModuleOperations(
  query: OperationListQuery = {},
): Promise<ActionResult<PaginatedResponse<ModuleOperation>>> {
  return attempt(async () => (await client()).get<PaginatedResponse<ModuleOperation>>(`/v1/site-modules/operations/${queryString(query)}`));
}

export async function getModuleOperation(id: string): Promise<ActionResult<ModuleOperationDetail>> {
  return attempt(async () => (await client()).get<ModuleOperationDetail>(`/v1/site-modules/operations/${encodeURIComponent(id)}/`));
}
