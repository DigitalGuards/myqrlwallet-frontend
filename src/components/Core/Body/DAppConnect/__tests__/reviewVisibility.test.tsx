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
import { observeReview } from "../reviewVisibility";
import { reviewValueKey } from "../reviewIdentity";

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
  identity = 1,
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
  view.rerender(<Review value="two" identity={2} />);
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

it.each(["block-scroll", "child-scroll", "child-left", "child-right"])(
  "invalidates completed coverage for %s overflow and requires fresh observations after repair",
  (kind) => {
    const { container } = render(<div><div data-review-block><span>Leaf</span></div></div>);
    const block = container.querySelector("[data-review-block]");
    const child = screen.getByText("Leaf");
    if (!(block instanceof HTMLElement)) throw new Error("Missing block");
    const changed = jest.fn();
    const controller = observeReview(container, changed);
    visibility.emit();
    expect(controller.refresh()).toBe(true);
    const stale = visibility.targets;
    let overflowing = true;
    if (kind.endsWith("scroll")) {
      Object.defineProperty(kind === "block-scroll" ? block : child, "scrollWidth", {
        configurable: true,
        get: () => overflowing ? 101 : 100,
      });
    } else {
      Object.defineProperty(child, "getBoundingClientRect", {
        value: () => new DOMRect(overflowing ? (kind === "child-left" ? -1 : 1) : 0, 0, 100, 32),
      });
    }
    // A resize must revoke completed credit even with unchanged text and size.
    if (kind.startsWith("child")) visibility.resize(child);
    else window.dispatchEvent(new Event("resize"));
    expect(changed).toHaveBeenLastCalledWith(false);
    visibility.emitQueued(stale);
    expect(controller.refresh()).toBe(false);
    expect(visibility.targets).toHaveLength(0);
    overflowing = false;
    expect(controller.refresh()).toBe(false);
    visibility.emitQueued(stale);
    expect(controller.refresh()).toBe(false);
    visibility.emit();
    expect(controller.refresh()).toBe(true);
    controller.dispose();
  },
);

it("detects new overflowing descendants through content mutations", async () => {
  const { container } = render(<div data-review-block>Reviewed</div>);
  const block = screen.getByText("Reviewed");
  const changed = jest.fn();
  const controller = observeReview(container, changed);
  visibility.emit();
  expect(controller.refresh()).toBe(true);
  const child = document.createElement("span");
  child.textContent = "Unseen leaf";
  Object.defineProperty(child, "getBoundingClientRect", { value: () => new DOMRect(110, 0, 20, 20) });
  block.append(child);
  await Promise.resolve();
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(visibility.targets).toHaveLength(0);
  controller.dispose();
});

it("checks horizontal overflow synchronously on submit before observers run", () => {
  const approve = jest.fn();
  render(<Review onApprove={approve} />);
  act(() => {
    visibility.emit();
  });
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(false);
  Object.defineProperty(screen.getByText("one"), "scrollWidth", { value: 101 });
  fireEvent.submit(screen.getByRole("form"));
  expect(approve).not.toHaveBeenCalled();
  expect(screen.getByText("Approve").hasAttribute("disabled")).toBe(true);
});

it.each([
  [{ a: 1, b: 23 }, { a1b: 23 }],
  [['ab'], ['a', 'b']],
  ['', undefined],
  [1, '1'],
  [1n, { bigint: '1' }],
])('revokes completed coverage for semantic collision pair %#', (before, after) => {
  const view = render(<Review value="same formatted text" exactValue={reviewValueKey(before)} />);
  act(() => { visibility.emit(); });
  const stale = visibility.targets;
  view.rerender(<Review value="same formatted text" exactValue={reviewValueKey(after)} />);
  expect(screen.getByText('Approve').hasAttribute('disabled')).toBe(true);
  act(() => { visibility.emitQueued(stale); });
  expect(screen.getByText('Approve').hasAttribute('disabled')).toBe(true);
  act(() => { visibility.emit(); });
  expect(screen.getByText('Approve').hasAttribute('disabled')).toBe(false);
});

it('preserves text-node boundaries when equal textContent contains different rows', () => {
  const view = render(<div data-review-block><span>a</span><span>1</span><span>b</span><span>23</span></div>);
  const controller = observeReview(view.container, jest.fn());
  visibility.emit();
  expect(controller.refresh()).toBe(true);
  const stale = visibility.targets;
  view.rerender(<div data-review-block><span>a1b</span><span>23</span></div>);
  expect(view.container.textContent).toBe('a1b23');
  expect(controller.refresh()).toBe(false);
  visibility.emitQueued(stale);
  expect(controller.refresh()).toBe(false);
  visibility.emit();
  expect(controller.refresh()).toBe(true);
  controller.dispose();
});

it('distinguishes a missing review attribute from an empty one', () => {
  const view = render(<div data-review-block data-review-value="">same</div>);
  const controller = observeReview(view.container, jest.fn());
  visibility.emit();
  expect(controller.refresh()).toBe(true);
  view.rerender(<div data-review-block>same</div>);
  expect(controller.refresh()).toBe(false);
  controller.dispose();
});
