import { describe, expect, it, vi } from "vitest";
import { configureDevActorHeader } from "./dev-proxy";

describe("local API dev proxy", () => {
  it("adds the development actor only when configured", () => {
    const on = vi.fn();
    configureDevActorHeader({ on }, "  actor-123  ");

    expect(on).toHaveBeenCalledWith("proxyReq", expect.any(Function));
    const request = { setHeader: vi.fn() };
    on.mock.calls[0][1](request);
    expect(request.setHeader).toHaveBeenCalledWith("x-actor-id", "actor-123");
  });

  it("does not register a header hook when the actor is absent", () => {
    const on = vi.fn();
    configureDevActorHeader({ on }, "  ");

    expect(on).not.toHaveBeenCalled();
  });
});
