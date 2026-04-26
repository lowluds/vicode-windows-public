import { describe, expect, it } from "vitest";
import { isOverlayAppRoute, toggleOverlayAppRoute } from "./app-route";

describe("app route helpers", () => {
  it("marks settings and skills as overlay routes", () => {
    expect(isOverlayAppRoute("settings")).toBe(true);
    expect(isOverlayAppRoute("skills")).toBe(true);
    expect(isOverlayAppRoute("thread")).toBe(false);
  });

  it("toggles an overlay route open from a base route", () => {
    expect(toggleOverlayAppRoute("thread", "settings", "thread")).toBe(
      "settings",
    );
    expect(toggleOverlayAppRoute("automations", "skills", "automations")).toBe(
      "skills",
    );
  });

  it("toggles an overlay route closed back to the last base route", () => {
    expect(toggleOverlayAppRoute("settings", "settings", "thread")).toBe(
      "thread",
    );
    expect(toggleOverlayAppRoute("skills", "skills", "automations")).toBe(
      "automations",
    );
  });

  it("switches directly between mutually exclusive overlays", () => {
    expect(toggleOverlayAppRoute("skills", "settings", "thread")).toBe(
      "settings",
    );
    expect(toggleOverlayAppRoute("settings", "skills", "thread")).toBe(
      "skills",
    );
  });
});
