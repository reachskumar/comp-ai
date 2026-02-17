import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertCircle } from "lucide-react";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("should render title and description", () => {
    render(
      <EmptyState
        icon={AlertCircle}
        title="No data found"
        description="There are no items to display."
      />
    );

    expect(screen.getByText("No data found")).toBeInTheDocument();
    expect(screen.getByText("There are no items to display.")).toBeInTheDocument();
  });

  it("should not render action button when no actionLabel is provided", () => {
    render(
      <EmptyState
        icon={AlertCircle}
        title="Empty"
        description="Nothing here"
      />
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("should render action button with onAction callback", async () => {
    const user = userEvent.setup();
    const handleAction = vi.fn();

    render(
      <EmptyState
        icon={AlertCircle}
        title="Empty"
        description="Nothing here"
        actionLabel="Add Item"
        onAction={handleAction}
      />
    );

    const button = screen.getByRole("button", { name: "Add Item" });
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it("should render action link when actionHref is provided", () => {
    render(
      <EmptyState
        icon={AlertCircle}
        title="Empty"
        description="Nothing here"
        actionLabel="Go to page"
        actionHref="/some-page"
      />
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/some-page");
    expect(screen.getByText("Go to page")).toBeInTheDocument();
  });
});

