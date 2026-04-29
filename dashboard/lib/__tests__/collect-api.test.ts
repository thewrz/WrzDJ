import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { apiClient } from "../api";

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

  it("submitCollectRequest POSTs JSON with credentials", async () => {
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
      expect.objectContaining({ method: "POST", credentials: "include" })
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

  it("voteCollectRequest POSTs the request_id with credentials", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ ok: true })
    );
    await apiClient.voteCollectRequest("ABC", 99);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC\/vote$/),
      expect.objectContaining({
        body: JSON.stringify({ request_id: 99 }),
        credentials: "include",
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

  it("getCollectProfile sends credentials and returns profile", async () => {
    const profile = { nickname: "DJ", email_verified: true, submission_count: 3, submission_cap: 15 };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(OK_RESPONSE(profile));
    const r = await apiClient.getCollectProfile("ABC");
    expect(r.email_verified).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC\/profile$/),
      expect.objectContaining({ method: "GET", credentials: "include" })
    );
  });

  it("setCollectProfile POSTs with credentials", async () => {
    const profile = { nickname: "DJ", email_verified: false, submission_count: 0, submission_cap: 15 };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(OK_RESPONSE(profile));
    await apiClient.setCollectProfile("ABC", { nickname: "DJ" });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC\/profile$/),
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });

  it("getCollectMyPicks sends credentials", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ submitted: [], upvoted: [], voted_request_ids: [], is_top_contributor: false, first_suggestion_ids: [] })
    );
    await apiClient.getCollectMyPicks("ABC");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC\/profile\/me$/),
      expect.objectContaining({ method: "GET", credentials: "include" })
    );
  });

  it("checkHasRequested sends credentials", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ has_requested: true })
    );
    const r = await apiClient.checkHasRequested("ABC");
    expect(r.has_requested).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/events\/ABC\/has-requested$/),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("getMyRequests sends credentials", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ requests: [] })
    );
    await apiClient.getMyRequests("ABC");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/events\/ABC\/my-requests$/),
      expect.objectContaining({ credentials: "include" })
    );
  });
});
