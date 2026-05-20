import { describe, it, expect, vi } from "vitest";
import { requireAuth } from "../middleware/requireAuth.js";

describe("requireAuth middleware", () => {
  const next = vi.fn();
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(),
  };

  it("calls next when user is present", () => {
    requireAuth({ user: { _id: "123" } }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when user is missing", () => {
    requireAuth({ user: null }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Not logged in" });
  });

  it("returns 401 when user is undefined", () => {
    requireAuth({}, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
