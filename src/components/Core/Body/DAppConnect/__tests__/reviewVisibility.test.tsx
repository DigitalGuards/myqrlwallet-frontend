/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useReviewVisibility } from "../useReviewVisibility";
import { mockReviewObservers } from "@/test-utils/reviewObserver";

let visibility: ReturnType<typeof mockReviewObservers>;
beforeEach(() => {
  visibility = mockReviewObservers(false);
});
afterEach(() => {
  cleanup();
  visibility.restore();
  jest.restoreAllMocks();
});

function Review({
  value = "one",
  exactValue = "",
  identity = "request",
  onApprove = jest.fn(),
  onReject = jest.fn(),
}) {
  const { ref, ready, canApprove } = useReviewVisibility(identity);
  const approve = () => {
    if (canApprove()) onApprove();
  };
  return (
    <div ref={ref}>
      <p data-review-block>Identity</p>
      <div data-review-region>
        <p data-review-block data-review-value={exactValue}>
          {value}
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          approve();
        }}
        aria-label="review"
      >
        <input
          aria-label="PIN"
          onKeyDown={(event) => {
            if (event.key === "Enter") approve();
          }}
        />
        <button type="button" disabled={!ready} onClick={approve}>
          Approve
        </button>
        <button type="button" onClick={onReject}>
          Reject
        </button>
      </form>
    </div>
  );
}

it("enables fitted content after its initial observations", () => {
  render(<Review />);
  expect(visibility.targets.length).toBeGreaterThan(0);
  act(() => {
    visibility.emit();
  });
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(false);
});

it("requires every tile, including the middle, at full intersection", () => {
  render(<Review />);
  const [first, ...rest] = visibility.targets;
  if (!first) throw new Error("Missing target");
  act(() => {
    visibility.emit(rest);
    visibility.emit([first], 0.99);
  });
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(true);
  act(() => {
    visibility.emit([first]);
  });
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(false);
});

it("rejects Chromium zero-area intersection reports and collapsed regions", () => {
  const { container } = render(<Review />);
  act(() => {
    visibility.emit(undefined, 1, 0);
  });
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(true);
  const region = container.querySelector("[data-review-region]");
  if (!(region instanceof HTMLElement)) throw new Error("Missing region");
  jest
    .spyOn(region, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 100, 0));
  act(() => {
    visibility.emit();
  });
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(true);
});

it("re-gates changed blocks, rejects stale callbacks, and preserves unchanged blocks", () => {
  const view = render(<Review />);
  act(() => {
    visibility.emit();
  });
  const oldTargets = visibility.targets;
  view.rerender(<Review value="two" />);
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(true);
  act(() => {
    visibility.emitQueued(oldTargets);
  });
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(true);
  act(() => {
    visibility.emit(
      visibility.targets.filter(
        (target) => target.parentElement?.textContent === "two",
      ),
    );
  });
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(false);
  view.rerender(<Review value="two" />);
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(false);
  view.rerender(<Review value="two" identity="replacement" />);
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(true);
});

it("re-gates an exact amount or fee change when formatted copy is unchanged", () => {
  const view = render(
    <Review value="1 Quanta" exactValue="1000000000000000000" />,
  );
  act(() => {
    visibility.emit();
  });
  view.rerender(<Review value="1 Quanta" exactValue="1000000000000000001" />);
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(true);
  act(() => {
    visibility.emit();
  });
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(false);
});

it("blocks click, keyboard and form submission while rejection remains available", () => {
  const approve = jest.fn();
  const reject = jest.fn();
  render(<Review onApprove={approve} onReject={reject} />);
  fireEvent.click(screen.getByText("Approve"));
  fireEvent.keyDown(screen.getByLabelText("PIN"), { key: "Enter" });
  fireEvent.submit(screen.getByRole("form"));
  fireEvent.click(screen.getByText("Reject"));
  expect(approve).not.toHaveBeenCalled();
  expect(reject).toHaveBeenCalledTimes(1);
  act(() => {
    visibility.emit();
  });
  fireEvent.submit(screen.getByRole("form"));
  expect(approve).toHaveBeenCalledTimes(1);
});
