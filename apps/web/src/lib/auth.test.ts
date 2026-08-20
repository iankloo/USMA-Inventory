import { describe, expect, it } from "vitest";
import { getInitialAuthState, isLocalApiDevSession } from "./auth";

describe("local API auth mode", () => {
  it("requires the Vite dev flag, real API mode, and an actor id", () => {
    expect(
      isLocalApiDevSession({
        DEV: true,
        VITE_DEMO_MODE: "false",
        VITE_DEV_ACTOR_ID: "actor-123",
      }),
    ).toBe(true);
  });

  it("does not bypass Cognito outside that explicit local combination", () => {
    expect(
      isLocalApiDevSession({
        DEV: false,
        VITE_DEMO_MODE: "false",
        VITE_DEV_ACTOR_ID: "actor-123",
      }),
    ).toBe(false);
    expect(
      isLocalApiDevSession({
        DEV: true,
        VITE_DEMO_MODE: "true",
        VITE_DEV_ACTOR_ID: "actor-123",
      }),
    ).toBe(false);
    expect(
      isLocalApiDevSession({
        DEV: true,
        VITE_DEMO_MODE: "false",
        VITE_DEV_ACTOR_ID: "  ",
      }),
    ).toBe(false);
  });

  it("starts the explicitly configured local API session without Cognito", () => {
    expect(
      getInitialAuthState(
        {
          DEV: true,
          VITE_DEMO_MODE: "false",
          VITE_DEV_ACTOR_ID: "actor-123",
        },
        false,
      ),
    ).toEqual({ authenticated: true, checking: false });
    expect(
      getInitialAuthState(
        { DEV: true, VITE_DEMO_MODE: "false" },
        false,
      ),
    ).toEqual({ authenticated: false, checking: false });
  });
});
