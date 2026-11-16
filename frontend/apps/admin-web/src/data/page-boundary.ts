"use client";
import {useEffect} from "react";
import {ApiError} from "@uog/api-client";

/** A saved page may disappear after a deletion. Never reinterpret access errors. */
export function usePageBoundary(page: number, setPage: (value: number) => void, data: {count: number; results: unknown[]} | null, error: ApiError | null) {
  useEffect(() => {
    const invalid = error?.status === 404 && /^Invalid page\.?$/i.test(error.message.trim());
    if (page > 1 && (invalid || (!error && data?.count === 0 && data.results.length === 0))) setPage(1);
  }, [page, setPage, data, error]);
}
