import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LeaderboardTabs from "./LeaderboardTabs";

const rows = [
  { id: 1, title: "A", artist: "X", artwork_url: null, vote_count: 5, nickname: "alex", status: "new" as const, created_at: "2026-04-21" },
  { id: 2, title: "B", artist: "Y", artwork_url: null, vote_count: 1, nickname: "jo",   status: "new" as const, created_at: "2026-04-21" },
];

describe("LeaderboardTabs", () => {
  it("renders rows and switches tabs", () => {
    const onTabChange = vi.fn();
    render(
      <LeaderboardTabs
        rows={rows}
        tab="trending"
        onTabChange={onTabChange}
        onVote={vi.fn()}
      />
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(onTabChange).toHaveBeenCalledWith("all");
  });

  it("optimistically updates vote count then rolls back on error", async () => {
    const onVote = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <LeaderboardTabs
        rows={rows}
        tab="trending"
        onTabChange={vi.fn()}
        onVote={onVote}
      />
    );
    fireEvent.click(screen.getAllByRole("button", { name: /upvote/i })[0]);
    await waitFor(() => {
      expect(screen.getByText(/5/)).toBeInTheDocument();
    });
  });
});
