"use client";
import {useState, type Dispatch, type SetStateAction} from "react";
import {hashKey, skipToken, useQuery} from "@tanstack/react-query";
import {GC_MS, queryKey, useQueryEnvironment} from "./query-cache";

/** Navigation controls only. Never store editor drafts, uploads or open dialogs here. */
export function useSectionState<T>(siteId: number, section: string, field: string, initial: T, persist = true): [T, Dispatch<SetStateAction<T>>] {
  const environment = useQueryEnvironment();
  const key = queryKey({...environment, siteId}, "section-state", {section, field});
  const identity = hashKey(key);
  // Disabled observer retains the entry while the section is mounted, then uses
  // the same bounded inactive GC as reads. There is no network query function.
  const cached = useQuery({queryKey: key, queryFn: skipToken, initialData: initial, gcTime: GC_MS});
  const [local, setLocal] = useState(() => ({identity, value: persist ? cached.data as T : initial}));
  const value = local.identity === identity ? local.value : persist ? cached.data as T : initial;
  if (local.identity !== identity) setLocal({identity, value});
  const setValue: Dispatch<SetStateAction<T>> = update => {
    if (!persist) {setLocal(previous => ({identity, value: typeof update === "function" ? (update as (value: T) => T)(previous.value) : update})); return;}
    const previous = environment.client.getQueryData<T>(key) ?? value;
    const next = typeof update === "function" ? (update as (value: T) => T)(previous) : update;
    environment.client.setQueryData(key, next);
    // Synchronous React state keeps controlled typing responsive; the cache is
    // the restore point for the next mount, not a second content fetch path.
    setLocal({identity, value: next});
  };
  return [value, setValue];
}
