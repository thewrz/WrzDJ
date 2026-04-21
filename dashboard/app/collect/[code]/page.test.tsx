import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import CollectPage from "./page";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useParams: () => ({ code: "ABC" }),
}));

const mockGetEvent = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiClient: {
    getCollectEvent: (...a: unknown[]) => mockGetEvent(...a),
    getCollectLeaderboard: vi.fn().mockResolvedValue({ requests: [], total: 0 }),
    getCollectMyPicks: vi.fn().mockResolvedValue({
      submitted: [], upvoted: [], is_top_contributor: false, first_suggestion_ids: []
    }),
    setCollectProfile: vi.fn().mockResolvedValue({
      has_email: false,
      submission_count: 0,
      submission_cap: 15,
    }),
  },
}));

describe("CollectPage", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockGetEvent.mockReset();
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows pre-announce countdown when phase is pre_announce", async () => {
    mockGetEvent.mockResolvedValue({
      code: "ABC",
      name: "Test Event",
      phase: "pre_announce",
      collection_opens_at: new Date(Date.now() + 3600_000).toISOString(),
      live_starts_at: new Date(Date.now() + 7200_000).toISOString(),
      submission_cap_per_guest: 15,
      banner_filename: null,
      registration_enabled: true,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    render(<CollectPage />);
    await waitFor(() => {
      expect(screen.getByText(/opens in/i)).toBeInTheDocument();
    });
  });

  it("renders collection experience when phase is collection", async () => {
    mockGetEvent.mockResolvedValue({
      code: "ABC",
      name: "Test Event",
      phase: "collection",
      collection_opens_at: new Date(Date.now() - 3600_000).toISOString(),
      live_starts_at: new Date(Date.now() + 3600_000).toISOString(),
      submission_cap_per_guest: 15,
      banner_filename: null,
      registration_enabled: true,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    render(<CollectPage />);
    await waitFor(() => {
      expect(screen.getByText(/test event/i)).toBeInTheDocument();
    });
  });

  it("redirects to /join when phase is live", async () => {
    mockGetEvent.mockResolvedValue({
      code: "ABC",
      name: "Test Event",
      phase: "live",
      collection_opens_at: new Date(Date.now() - 86400_000).toISOString(),
      live_starts_at: new Date(Date.now() - 3600_000).toISOString(),
      submission_cap_per_guest: 15,
      banner_filename: null,
      registration_enabled: true,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    render(<CollectPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/join/ABC");
    });
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      "wrzdj_live_splash_ABC",
      "1"
    );
  });
});
