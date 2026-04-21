import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PreEventVotingTab from "../PreEventVotingTab";

const baseEvent = {
  code: "ABC",
  name: "Wedding",
  collection_opens_at: "2026-04-21T12:00:00Z",
  live_starts_at: "2026-04-22T20:00:00Z",
  submission_cap_per_guest: 15,
  collection_phase_override: null,
  phase: "collection" as const,
};

vi.mock("@/lib/api", () => ({
  apiClient: {
    patchCollectionSettings: vi.fn().mockResolvedValue({
      code: "ABC",
      name: "Wedding",
      collection_opens_at: "2026-04-21T12:00:00Z",
      live_starts_at: "2026-04-22T20:00:00Z",
      submission_cap_per_guest: 15,
      collection_phase_override: "force_live",
      phase: "live",
    }),
    getPendingReview: vi.fn().mockResolvedValue({ requests: [], total: 0 }),
    bulkReview: vi.fn().mockResolvedValue({ accepted: 0, rejected: 0, unchanged: 0 }),
  },
}));

describe("PreEventVotingTab", () => {
  it("renders phase and share link", () => {
    render(<PreEventVotingTab event={baseEvent} onEventChange={vi.fn()} />);
    expect(screen.getByText(/phase:\s*collection/i)).toBeInTheDocument();
    expect(screen.getByText(/\/collect\/ABC/i)).toBeInTheDocument();
  });

  it("applies force_live override via button", async () => {
    const onEventChange = vi.fn();
    render(<PreEventVotingTab event={baseEvent} onEventChange={onEventChange} />);
    fireEvent.click(screen.getByRole("button", { name: /start live now/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => {
      expect(onEventChange).toHaveBeenCalled();
    });
  });
});
