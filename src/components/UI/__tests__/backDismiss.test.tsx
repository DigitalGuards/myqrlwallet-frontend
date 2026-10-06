/**
 * @jest-environment jsdom
 *
 * Back closes the topmost overlay through the overlay's own close path, so an
 * approval or signing sheet cancels or rejects exactly as its X button does
 * and can never approve.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/UI/Dialog";
import {
  resetNativeBackForTests,
  resolveNativeBack,
} from "@/utils/nativeBack";

const navigate = jest.fn((_path: string) => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  resetNativeBackForTests();
});

const approve = jest.fn();
const reject = jest.fn();

/** Stand-in for a dApp approval sheet: closing it must mean reject. */
const ApprovalSheet = ({ onDecided }: { onDecided: () => void }) => {
  const [open, setOpen] = useState(true);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // The same path the X button takes.
          reject();
          onDecided();
        }
        setOpen(next);
      }}
    >
      <DialogContent>
        <DialogTitle>Approve transaction</DialogTitle>
        <button onClick={approve}>Approve</button>
      </DialogContent>
    </Dialog>
  );
};

describe("a controlled Dialog answers back", () => {
  it("closes on back and reports handled", () => {
    const onDecided = jest.fn();
    render(<ApprovalSheet onDecided={onDecided} />);
    expect(screen.getByText("Approve transaction")).toBeTruthy();

    expect(resolveNativeBack(navigate, "/transfer")).toBe("handled");

    expect(onDecided).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejects rather than approves", () => {
    render(<ApprovalSheet onDecided={jest.fn()} />);

    resolveNativeBack(navigate, "/transfer");

    expect(reject).toHaveBeenCalledTimes(1);
    expect(approve).not.toHaveBeenCalled();
  });

  it("unregisters once closed, so the next back navigates", () => {
    const { rerender } = render(<ApprovalSheet onDecided={jest.fn()} />);
    resolveNativeBack(navigate, "/transfer");
    rerender(<ApprovalSheet onDecided={jest.fn()} />);

    // The dialog above closed and a fresh one mounted open; close that too,
    // then the route layer takes over.
    resolveNativeBack(navigate, "/transfer");
    expect(resolveNativeBack(navigate, "/transfer")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("leaves an uncontrolled dialog to Radix", () => {
    render(
      <Dialog>
        <DialogContent>
          <DialogTitle>Uncontrolled</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // No `open` prop means no registration, so back falls through to routing.
    expect(resolveNativeBack(navigate, "/")).toBe("at-root");
  });
});
