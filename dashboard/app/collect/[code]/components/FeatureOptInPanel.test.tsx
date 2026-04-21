import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FeatureOptInPanel from "./FeatureOptInPanel";

describe("FeatureOptInPanel", () => {
  it("does not render when hasEmail is true", () => {
    render(<FeatureOptInPanel hasEmail={true} onSave={vi.fn()} />);
    expect(screen.queryByText(/add email/i)).not.toBeInTheDocument();
  });

  it("shows feature comparison and save button", () => {
    render(<FeatureOptInPanel hasEmail={false} onSave={vi.fn()} />);
    expect(screen.getByText(/notify me when my song plays/i)).toBeInTheDocument();
    expect(screen.getByText(/cross-device/i)).toBeInTheDocument();
  });

  it("rejects invalid email on client", async () => {
    const onSave = vi.fn();
    render(<FeatureOptInPanel hasEmail={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "bogus" } });
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onSave with valid email", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FeatureOptInPanel hasEmail={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "guest@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("guest@example.com");
    });
  });
});
