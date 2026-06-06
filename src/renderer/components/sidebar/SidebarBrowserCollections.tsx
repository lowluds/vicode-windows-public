import type { CSSProperties } from "react";
import {
  browserCollectionDefinitions,
  type BrowserCollectionId,
} from "../AppSidebar.collections";

export function SidebarBrowserCollectionIcon({
  collectionId,
}: {
  collectionId: BrowserCollectionId;
}) {
  const collection = browserCollectionDefinitions.find(
    (definition) => definition.id === collectionId,
  );
  return (
    <span
      className="work-library-collection-icon"
      style={
        {
          "--work-library-collection-color":
            collection?.color ?? "var(--ui-danger)",
        } as CSSProperties
      }
      aria-hidden="true"
    />
  );
}

export function createSidebarBrowserCollectionEntries(
  collections: Array<{ id: BrowserCollectionId }>,
  getLabel: (collectionId: BrowserCollectionId) => string,
) {
  return collections.map((collection) => ({
    id: collection.id,
    label: getLabel(collection.id),
    icon: <SidebarBrowserCollectionIcon collectionId={collection.id} />,
    collectionId: collection.id,
  }));
}
