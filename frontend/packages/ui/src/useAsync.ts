"use client";

/**
 * Shared async data-fetching hook for admin screens.
 *
 * Every list/detail screen in the console drives its loading, error and
 * empty states through this hook so behaviour stays consistent: one place
 * decides what "loading" looks like, how a failure is surfaced (including
 * the backend correlation id) and how a reload is triggered.
 *
 * It deliberately owns no transport: pass a promise-producing function, so
 * the same hook works against the live API adapter, a mock adapter or a
 * server action. Requests are cancelled when dependencies change or the
 * component unmounts, so a slow response can never overwrite a newer one.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@uog/api-client";

export type AsyncStatus = "idle" | "loading" | "success" | "error";

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: ApiError | null;
  /** True while a request is in flight (including background reloads). */
  loading: boolean;
  /** Re-run the fetch function, keeping any previously loaded data. */
  reload: () => void;
  /** Replace the data locally (e.g. after a mutation). */
  setData: (updater: T | ((previous: T | null) => T)) => void;
}

/**
 * Run `fetcher` whenever `deps` change, exposing status/data/error.
 *
 * `isEmpty` (optional) decides the derived `empty` flag so screens can show
 * an empty state without re-implementing the check per resource.
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
  options: { isEmpty?: (data: T) => boolean } = {},
): AsyncState<T> & { empty: boolean } {
  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const isEmptyRef = useRef(options.isEmpty);
  isEmptyRef.current = options.isEmpty;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setDataState(result);
        setStatus("success");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Normalise anything thrown into the shared ApiError so screens can
        // read `code`, `status` and `requestId` uniformly.
        setError(cause instanceof ApiError ? cause : ApiError.fromUnknown(cause));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const setData = useCallback(
    (updater: T | ((previous: T | null) => T)) => {
      setDataState((previous) =>
        typeof updater === "function"
          ? (updater as (prev: T | null) => T)(previous)
          : updater,
      );
    },
    [],
  );

  const empty =
    status === "success" &&
    data !== null &&
    (isEmptyRef.current?.(data) ?? false);

  return {
    status,
    data,
    error,
    loading: status === "loading",
    reload,
    setData,
    empty,
  };
}
