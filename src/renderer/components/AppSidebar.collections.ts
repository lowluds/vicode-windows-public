export const browserCollectionDefinitions = [
  { id: "favorites", defaultLabel: "Favorites", color: "var(--ui-collection-red)", shortcut: "1" },
  { id: "orange", defaultLabel: "Orange", color: "var(--ui-collection-orange)", shortcut: "2" },
  { id: "yellow", defaultLabel: "Yellow", color: "var(--ui-collection-yellow)", shortcut: "3" },
  { id: "green", defaultLabel: "Green", color: "var(--ui-collection-green)", shortcut: "4" },
  { id: "blue", defaultLabel: "Blue", color: "var(--ui-collection-blue)", shortcut: "5" },
  { id: "purple", defaultLabel: "Purple", color: "var(--ui-collection-purple)", shortcut: "6" },
  { id: "gray", defaultLabel: "Gray", color: "var(--ui-collection-gray)", shortcut: "7" },
] as const;

export type BrowserCollectionId = (typeof browserCollectionDefinitions)[number]["id"];

export interface BrowserCollectionState {
  assignments: Record<string, BrowserCollectionId>;
  labels: Record<BrowserCollectionId, string>;
}

export const browserCollectionsStorageKey = "vicode.work-library.collections.v1";

const collectionIds = new Set<string>(
  browserCollectionDefinitions.map((collection) => collection.id),
);

const defaultBrowserCollectionLabels: Record<BrowserCollectionId, string> = {
  favorites: "Favorites",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  gray: "Gray",
};

export function isBrowserCollectionId(value: unknown): value is BrowserCollectionId {
  return typeof value === "string" && collectionIds.has(value);
}

export function createDefaultBrowserCollectionState(): BrowserCollectionState {
  return {
    assignments: {},
    labels: { ...defaultBrowserCollectionLabels },
  };
}

export function browserCollectionDefaultLabel(collectionId: BrowserCollectionId) {
  return defaultBrowserCollectionLabels[collectionId];
}

export function sanitizeBrowserCollectionState(value: unknown): BrowserCollectionState {
  const next = createDefaultBrowserCollectionState();
  if (!value || typeof value !== "object") {
    return next;
  }

  const input = value as {
    assignments?: unknown;
    labels?: unknown;
  };

  if (input.labels && typeof input.labels === "object") {
    const labels = input.labels as Record<string, unknown>;
    for (const collection of browserCollectionDefinitions) {
      const label = labels[collection.id];
      if (typeof label === "string" && label.trim()) {
        next.labels[collection.id] = label.trim().slice(0, 40);
      }
    }
  }

  if (input.assignments && typeof input.assignments === "object") {
    const assignments = input.assignments as Record<string, unknown>;
    for (const [entryId, collectionId] of Object.entries(assignments)) {
      if (entryId.trim() && isBrowserCollectionId(collectionId)) {
        next.assignments[entryId] = collectionId;
      }
    }
  }

  return next;
}

export function readStoredBrowserCollectionState() {
  if (typeof window === "undefined") {
    return createDefaultBrowserCollectionState();
  }

  try {
    const stored = window.localStorage.getItem(browserCollectionsStorageKey);
    return sanitizeBrowserCollectionState(stored ? JSON.parse(stored) : null);
  } catch {
    return createDefaultBrowserCollectionState();
  }
}

export function writeStoredBrowserCollectionState(state: BrowserCollectionState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(browserCollectionsStorageKey, JSON.stringify(state));
  } catch {
    // Sidebar collections are a convenience preference; storage failures should not break render.
  }
}
