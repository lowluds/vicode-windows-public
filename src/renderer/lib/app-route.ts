export type AppRoute =
  | "thread"
  | "collab"
  | "skills"
  | "automations"
  | "settings"
  | "ui-dev";

export type OverlayAppRoute = "settings" | "skills";
export type BaseAppRoute = Exclude<AppRoute, OverlayAppRoute>;

export function isOverlayAppRoute(route: AppRoute): route is OverlayAppRoute {
  return route === "settings" || route === "skills";
}

export function toggleOverlayAppRoute(
  currentRoute: AppRoute,
  overlayRoute: OverlayAppRoute,
  fallbackRoute: BaseAppRoute,
): AppRoute {
  return currentRoute === overlayRoute ? fallbackRoute : overlayRoute;
}
