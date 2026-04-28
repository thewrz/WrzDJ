import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import CollectPage from "./page";

vi.mock("./components/EmailVerification", () => ({
  default: () => <div data-testid="email-verification-stub" />,
}));

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useParams: () => ({ code: "ABC" }),
}));

const mockGetEvent = vi.fn();
const mockGetCollectProfile = vi.fn();
const mockSetCollectProfile = vi.fn();
const mockGetCollectLeaderboard = vi.fn();
const mockSubmitCollectRequest = vi.fn();
const mockEventSearch = vi.fn();

vi.mock("../../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  apiClient: {
    getCollectEvent: (...a: unknown[]) => mockGetEvent(...a),
    getCollectLeaderboard: (...a: unknown[]) => mockGetCollectLeaderboard(...a),
    getCollectMyPicks: vi.fn().mockResolvedValue({
      submitted: [], upvoted: [], is_top_contributor: false, first_suggestion_ids: [], voted_request_ids: []
    }),
    getCollectProfile: (...a: unknown[]) => mockGetCollectProfile(...a),
    setCollectProfile: (...a: unknown[]) => mockSetCollectProfile(...a),
    submitCollectRequest: (...a: unknown[]) => mockSubmitCollectRequest(...a),
    eventSearch: (...a: unknown[]) => mockEventSearch(...a),
    search: vi.fn().mockResolvedValue([]),
    voteCollectRequest: vi.fn().mockResolvedValue(undefined),
  },
}));

const COLLECTION_EVENT = {
  code: "ABC",
  name: "Test Event",
  phase: "collection" as const,
  collection_opens_at: new Date(Date.now() - 3600_000).toISOString(),
  live_starts_at: new Date(Date.now() + 3600_000).toISOString(),
  submission_cap_per_guest: 15,
  banner_filename: null,
  registration_enabled: true,
  expires_at: new Date(Date.now() + 86400_000).toISOString(),
};

describe("CollectPage", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockGetEvent.mockReset();
    const defaultProfile = {
      email_verified: false,
      nickname: null,
      submission_count: 0,
      submission_cap: 15,
    };
    mockGetCollectProfile.mockResolvedValue(defaultProfile);
    mockSetCollectProfile.mockResolvedValue(defaultProfile);
    mockGetCollectLeaderboard.mockResolvedValue({ requests: [], total: 0 });
    mockSubmitCollectRequest.mockResolvedValue({ id: 42 });
    mockEventSearch.mockResolvedValue([]);
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue(null),
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
      expect(screen.getByText(/until voting opens/i)).toBeInTheDocument();
    });
  });

  it("renders collection experience when phase is collection", async () => {
    mockGetEvent.mockResolvedValue(COLLECTION_EVENT);
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

  it("hides FeatureOptInPanel when profile returns email_verified true with nickname", async () => {
    mockGetEvent.mockResolvedValue(COLLECTION_EVENT);
    mockGetCollectProfile.mockResolvedValue({
      email_verified: true,
      nickname: "DancingQueen",
      submission_count: 0,
      submission_cap: 15,
    });
    render(<CollectPage />);
    await waitFor(() => {
      expect(screen.getByText(/test event/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/make it yours/i)).not.toBeInTheDocument();
  });

  it("calls submitCollectRequest and refreshes profile after track select", async () => {
    mockGetEvent.mockResolvedValue(COLLECTION_EVENT);

    // Initial profile load goes through getCollectProfile; post-submit refresh
    // also hits getCollectProfile (not setCollectProfile) now that reads and
    // writes have separate endpoints.
    mockGetCollectProfile
      .mockResolvedValueOnce({
        email_verified: false,
        nickname: null,
        submission_count: 0,
        submission_cap: 15,
      })
      .mockResolvedValueOnce({
        email_verified: false,
        nickname: null,
        submission_count: 1,
        submission_cap: 15,
      });

    mockSubmitCollectRequest.mockResolvedValue({ id: 42 });

    const track = {
      artist: "Daft Punk",
      title: "Harder Better Faster Stronger",
      album: null,
      popularity: 90,
      spotify_id: "spotify-123",
      album_art: null,
      preview_url: null,
      url: "https://open.spotify.com/track/spotify-123",
      source: "spotify" as const,
      genre: null,
      bpm: null,
      key: null,
      isrc: null,
    };
    mockEventSearch.mockResolvedValue([track]);

    render(<CollectPage />);

    // Wait for collection phase to render the SubmitBar
    await waitFor(() => {
      expect(screen.getByText(/add a song/i)).toBeInTheDocument();
    });

    // Open search modal
    fireEvent.click(screen.getByText(/add a song/i));

    await waitFor(() => {
      expect(screen.getByTestId("collect-search-input")).toBeInTheDocument();
    });

    // Type query and search
    fireEvent.change(screen.getByTestId("collect-search-input"), {
      target: { value: "Daft Punk" },
    });
    fireEvent.submit(screen.getByTestId("collect-search-input").closest("form")!);

    // Wait for result to appear
    await waitFor(() => {
      expect(screen.getByTestId("collect-search-result")).toBeInTheDocument();
    });

    // Click the result to submit
    fireEvent.click(screen.getByTestId("collect-search-result"));

    await waitFor(() => {
      expect(mockSubmitCollectRequest).toHaveBeenCalledWith("ABC", {
        song_title: track.title,
        artist: track.artist,
        source: track.source,
        source_url: track.url,
        artwork_url: undefined,
        nickname: undefined,
      });
    });

    // Profile should have been refreshed at least once after submit
    // (initial load + post-submit refresh, both via the read endpoint)
    expect(mockGetCollectProfile.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
