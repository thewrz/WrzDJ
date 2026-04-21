import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { apiClient } from "../api";

const OK_RESPONSE = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe("collect api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getCollectEvent issues GET /api/public/collect/{code}", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ code: "ABC", phase: "collection" })
    );
    const r = await apiClient.getCollectEvent("ABC");
    expect(r.phase).toBe("collection");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC$/),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("submitCollectRequest POSTs JSON", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ id: 42 })
    );
    await apiClient.submitCollectRequest("ABC", {
      song_title: "T",
      artist: "A",
      source: "spotify",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC\/requests$/),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("voteCollectRequest POSTs the request_id", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ ok: true })
    );
    await apiClient.voteCollectRequest("ABC", 99);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC\/vote$/),
      expect.objectContaining({
        body: JSON.stringify({ request_id: 99 }),
      })
    );
  });
});
