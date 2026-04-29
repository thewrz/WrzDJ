import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SubmitBar from "./SubmitBar";

describe("SubmitBar", () => {
  it("disables button at cap", () => {
    render(
      <SubmitBar used={15} cap={15} onOpenSearch={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /Request a song/i })).toBeDisabled();
  });

  it("button enabled when cap is 0 (unlimited)", () => {
    render(
      <SubmitBar used={99} cap={0} onOpenSearch={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /Request a song/i })).not.toBeDisabled();
  });
});
