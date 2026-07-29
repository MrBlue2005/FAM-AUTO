import { afterEach, describe, expect, it, vi } from "vitest";
import { requireStudioAuth } from "@/lib/studio-auth";

afterEach(() => vi.unstubAllGlobals());

describe("autentificarea studioului", () => {
  it("acceptă o sesiune validă și transmite cookie-ul către API", async () => {
    const authFetch = vi.fn().mockResolvedValue(Response.json({ enabled: true, authenticated: true }));
    vi.stubGlobal("fetch", authFetch);

    await expect(requireStudioAuth(new Request("http://localhost/api/history", {
      headers: { cookie: "rx_session=session-token" },
    }))).resolves.toBeUndefined();
    expect(authFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { cookie: "rx_session=session-token" },
    }));
  });

  it("respinge o sesiune lipsă", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ enabled: true, authenticated: false })));
    await expect(requireStudioAuth(new Request("http://localhost/api/history"))).rejects.toMatchObject({ status: 401 });
  });

  it("respinge mutațiile fără antetul CSRF", async () => {
    const authFetch = vi.fn();
    vi.stubGlobal("fetch", authFetch);
    await expect(requireStudioAuth(new Request("http://localhost/api/history", { method: "POST" })))
      .rejects.toMatchObject({ status: 403 });
    expect(authFetch).not.toHaveBeenCalled();
  });
});
