"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "anime-quarter-schedule:user-prefs:v1";

export interface UserAnimePrefs {
  followedIds: string[];
  completedIds: string[];
}

export interface UserAnimePrefsControls {
  followedIds: ReadonlySet<string>;
  completedIds: ReadonlySet<string>;
  isLoaded: boolean;
  toggleFollow: (id: string) => void;
  toggleCompleted: (id: string) => void;
}

const emptyPrefs: UserAnimePrefs = {
  followedIds: [],
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
      const completedIds = toggleId(current.completedIds, id);
      const next = normalizePrefs({ ...current, completedIds });
      writePrefs(next);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      followedIds: new Set(prefs.followedIds),
      completedIds: new Set(prefs.completedIds),
      isLoaded,
      toggleFollow,
      toggleCompleted
    }),
    [isLoaded, prefs.completedIds, prefs.followedIds, toggleCompleted, toggleFollow]
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
  return {
    followedIds: normalizeIds(input.followedIds),
    completedIds: normalizeIds(input.completedIds)
  };
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}
