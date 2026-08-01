"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnimeItem } from "@/src/server/types/anime";

const STORAGE_KEY = "anime-quarter-schedule:user-prefs:v1";

export interface UserAnimePrefs {
  followedIds: string[];
  watchingIds: string[];
  completedIds: string[];
}

export interface UserAnimePrefsControls {
  followedIds: ReadonlySet<string>;
  watchingIds: ReadonlySet<string>;
  completedIds: ReadonlySet<string>;
  isLoaded: boolean;
  toggleFollow: (id: string) => void;
  toggleWatching: (id: string) => void;
  toggleCompleted: (id: string) => void;
  reconcileAnimeStatuses: (items: Array<Pick<AnimeItem, "id" | "status">>) => void;
}

const emptyPrefs: UserAnimePrefs = {
  followedIds: [],
  watchingIds: [],
  completedIds: []
};

export function useUserAnimePrefs(): UserAnimePrefsControls {
  const [prefs, setPrefs] = useState<UserAnimePrefs>(emptyPrefs);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setPrefs(readPrefs());
    setIsLoaded(true);
  }, []);

  const toggleFollow = useCallback((id: string) => {
    setPrefs((current) => {
      const followedIds = toggleId(current.followedIds, id);
      const next = normalizePrefs({ ...current, followedIds });
      writePrefs(next);
      return next;
    });
  }, []);

  const toggleCompleted = useCallback((id: string) => {
    setPrefs((current) => {
      const next = toggleCompletedInPrefs(current, id);
      writePrefs(next);
      return next;
    });
  }, []);

  const toggleWatching = useCallback((id: string) => {
    setPrefs((current) => {
      const next = toggleWatchingInPrefs(current, id);
      writePrefs(next);
      return next;
    });
  }, []);

  const reconcileAnimeStatuses = useCallback((items: Array<Pick<AnimeItem, "id" | "status">>) => {
    setPrefs((current) => {
      const next = reconcilePrefsWithAnimeStatuses(current, items);
      if (next === current) return current;
      writePrefs(next);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      followedIds: new Set(prefs.followedIds),
      watchingIds: new Set(prefs.watchingIds),
      completedIds: new Set(prefs.completedIds),
      isLoaded,
      toggleFollow,
      toggleWatching,
      toggleCompleted,
      reconcileAnimeStatuses
    }),
    [
      isLoaded,
      prefs.completedIds,
      prefs.followedIds,
      prefs.watchingIds,
      reconcileAnimeStatuses,
      toggleCompleted,
      toggleFollow,
      toggleWatching
    ]
  );
}

function readPrefs(): UserAnimePrefs {
  if (!canUseLocalStorage()) return emptyPrefs;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPrefs;
    return normalizePrefs(JSON.parse(raw) as Partial<UserAnimePrefs>);
  } catch {
    return emptyPrefs;
  }
}

function writePrefs(prefs: UserAnimePrefs) {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can fail in private mode or low-quota environments; keep the in-memory state usable.
  }
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}

function normalizePrefs(input: Partial<UserAnimePrefs>): UserAnimePrefs {
  const completedIds = normalizeIds(input.completedIds);
  const completedIdSet = new Set(completedIds);

  return {
    followedIds: normalizeIds(input.followedIds),
    watchingIds: normalizeIds(input.watchingIds).filter((id) => !completedIdSet.has(id)),
    completedIds
  };
}

export function toggleWatchingInPrefs(prefs: UserAnimePrefs, id: string): UserAnimePrefs {
  const current = normalizePrefs(prefs);
  if (current.completedIds.includes(id)) return current;

  return normalizePrefs({
    ...current,
    watchingIds: toggleId(current.watchingIds, id)
  });
}

export function toggleCompletedInPrefs(prefs: UserAnimePrefs, id: string): UserAnimePrefs {
  const current = normalizePrefs(prefs);
  const completedIds = toggleId(current.completedIds, id);
  const completedIdSet = new Set(completedIds);

  return normalizePrefs({
    ...current,
    watchingIds: current.watchingIds.filter((watchingId) => !completedIdSet.has(watchingId)),
    completedIds
  });
}

export function reconcilePrefsWithAnimeStatuses(
  prefs: UserAnimePrefs,
  items: Array<Pick<AnimeItem, "id" | "status">>
): UserAnimePrefs {
  const finishedIds = new Set(items.filter((item) => item.status === "finished").map((item) => item.id));
  const knownIds = new Set(items.map((item) => item.id));
  const next = normalizePrefs({
    ...prefs,
    followedIds: prefs.followedIds.filter((id) => !finishedIds.has(id)),
    watchingIds: prefs.watchingIds.filter((id) => !knownIds.has(id) || finishedIds.has(id))
  });

  return prefsEqual(normalizePrefs(prefs), next) ? prefs : next;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function prefsEqual(left: UserAnimePrefs, right: UserAnimePrefs): boolean {
  return (
    arrayEqual(left.followedIds, right.followedIds) &&
    arrayEqual(left.watchingIds, right.watchingIds) &&
    arrayEqual(left.completedIds, right.completedIds)
  );
}

function arrayEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
