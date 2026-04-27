import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { apiClient, ApiError } from "../api";

const OK_RESPONSE = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

const ERR_RESPONSE = (status: number, detail: string) =>
  ({ ok: false, status, json: async () => ({ detail }) }) as Response;

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

  it("submitCollectRequest returns is_duplicate flag", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ id: 7, is_duplicate: true })
    );
    const r = await apiClient.submitCollectRequest("ABC", {
      song_title: "T",
      artist: "A",
      source: "spotify",
    });
    expect(r.is_duplicate).toBe(true);
    expect(r.id).toBe(7);
  });

  it("submitCollectRequest throws ApiError on 409", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      ERR_RESPONSE(409, "You already picked this one!")
    );
    await expect(
      apiClient.submitCollectRequest("ABC", {
        song_title: "T",
        artist: "A",
        source: "spotify",
      })
    ).rejects.toThrow("You already picked this one!");
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

  it("voteCollectRequest throws ApiError with detail on 409", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      ERR_RESPONSE(409, "Can't vote on your own pick")
    );
    await expect(apiClient.voteCollectRequest("ABC", 99)).rejects.toThrow(
      "Can't vote on your own pick"
    );
  });
});
