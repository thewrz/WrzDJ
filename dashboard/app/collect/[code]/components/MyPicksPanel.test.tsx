import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MyPicksPanel from "./MyPicksPanel";

const basePick = {
  id: 1,
  title: "Mr. Brightside",
  artist: "The Killers",
  artwork_url: null,
  vote_count: 12,
  nickname: "me",
  status: "new" as const,
  created_at: "2026-04-21T00:00:00Z",
  interaction: "submitted" as const,
};

describe("MyPicksPanel", () => {
  it("shows empty state when no picks", () => {
    render(
      <MyPicksPanel
        picks={{ submitted: [], upvoted: [], is_top_contributor: false, first_suggestion_ids: [], voted_request_ids: [] }}
      />
    );
    expect(screen.getByText(/no picks yet/i)).toBeInTheDocument();
  });

  it("shows top contributor badge when flagged", () => {
    render(
      <MyPicksPanel
        picks={{
          submitted: [basePick],
          upvoted: [],
          is_top_contributor: true,
          first_suggestion_ids: [],
          voted_request_ids: [],
        }}
      />
    );
    expect(screen.getByText(/top contributor/i)).toBeInTheDocument();
  });

  it("shows first-to-suggest badge on matching pick", () => {
    render(
      <MyPicksPanel
        picks={{
          submitted: [basePick],
          upvoted: [],
          is_top_contributor: false,
          first_suggestion_ids: [1],
          voted_request_ids: [1],
        }}
      />
    );
    expect(screen.getByText(/first to suggest/i)).toBeInTheDocument();
  });
});
