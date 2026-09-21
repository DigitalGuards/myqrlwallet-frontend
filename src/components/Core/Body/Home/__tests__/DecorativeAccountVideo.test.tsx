/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import DecorativeAccountVideo from "../DecorativeAccountVideo";
import type { NativeMessage } from "@/utils/nativeApp";

let mockNativeListener: ((message: NativeMessage) => void) | undefined;
const mockUnsubscribe = jest.fn();
jest.mock("@/utils/nativeApp", () => ({
  subscribeToNativeMessages: (listener: (message: NativeMessage) => void) => {
    mockNativeListener = listener;
    return mockUnsubscribe;
  },
}));

let hidden = false;
let reducedMotion = false;
let paused = true;
let motion: MediaQueryList;
let play: jest.SpyInstance;
let pause: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  hidden = false;
  reducedMotion = false;
  paused = true;
  mockUnsubscribe.mockClear();
  motion = new EventTarget() as MediaQueryList;
  Object.defineProperty(motion, "matches", { get: () => reducedMotion });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => motion,
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  jest
    .spyOn(HTMLMediaElement.prototype, "paused", "get")
    .mockImplementation(() => paused);
  play = jest
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  pause = jest
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => {
      paused = true;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function mountVideo() {
  const view = render(<DecorativeAccountVideo />);
  act(() => jest.advanceTimersByTime(0));
  const video = view.container.querySelector("video");
  if (!video || !video.parentElement)
    throw new Error("Missing decorative video");
  return { ...view, video, media: video.parentElement };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function native(
  type: NativeMessage["type"],
  payload?: NativeMessage["payload"],
) {
  act(() => {
    mockNativeListener?.({ type, payload });
    jest.advanceTimersByTime(0);
  });
}

function visibility(value: boolean) {
  hidden = value;
  fireEvent(document, new Event("visibilitychange"));
  act(() => jest.advanceTimersByTime(0));
}

function expectNoTimers() {
  act(() => jest.runAllTicks());
  expect(jest.getTimerCount()).toBe(0);
}

it("starts silent inline media, reveals only actual playback, and keeps decoration out of accessibility", async () => {
  const { video, media, container } = mountVideo();
  expect(play).toHaveBeenCalledTimes(1);
  expect(video.muted).toBe(true);
  expect(video.defaultMuted).toBe(true);
  expect(video.playsInline).toBe(true);
  expect(video.controls).toBe(false);
  expect(video.autoplay).toBe(false);
  expect(video.preload).toBe("none");
  expect(video.tabIndex).toBe(-1);
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  expect(media.style.opacity).toBe("0");
  await flush();
  expect(media.style.opacity).toBe("0");
  paused = false;
  fireEvent.playing(video);
  expect(media.style.opacity).toBe("1");
  expectNoTimers();
});

it("limits rejection retries to three and keeps the static fallback without polling", async () => {
  play.mockRejectedValue(new DOMException("Blocked", "NotAllowedError"));
  const { video, media } = mountVideo();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(play).toHaveBeenCalledTimes(3);
  expect(media.style.opacity).toBe("0");
  expect(jest.getTimerCount()).toBe(0);
  for (let count = 0; count < 10; count += 1) {
    fireEvent.canPlay(video);
    fireEvent.loadedData(video);
  }
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60000);
  });
  expect(play).toHaveBeenCalledTimes(3);
});

it("coalesces loading events and rerenders while play is pending", async () => {
  play.mockReturnValue(new Promise(() => undefined));
  const { video, rerender } = mountVideo();
  fireEvent.canPlay(video);
  fireEvent.loadedData(video);
  rerender(<DecorativeAccountVideo />);
  expect(play).toHaveBeenCalledTimes(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(4000);
  });
  expect(jest.getTimerCount()).toBe(0);
  expect(pause).toHaveBeenCalled();
});

it("rejects a late playing event and play resolution after the deadline", async () => {
  let resolvePlay: (() => void) | undefined;
  play.mockReturnValue(
    new Promise<void>((resolve) => {
      resolvePlay = resolve;
    }),
  );
  const { video, media } = mountVideo();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(4000);
  });
  paused = false;
  fireEvent.playing(video);
  await act(async () => resolvePlay?.());
  expect(paused).toBe(true);
  expect(media.style.opacity).toBe("0");
});

it("pauses on native inactivity and retries when active, coalescing duplicate active messages", async () => {
  const { video, media } = mountVideo();
  paused = false;
  fireEvent.playing(video);
  native("APP_STATE", { state: "inactive" });
  expect(media.style.opacity).toBe("0");
  expect(paused).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  native("APP_STATE", { state: "active" });
  await flush();
  native("APP_STATE", { state: "active" });
  expect(play).toHaveBeenCalledTimes(2);
});

it("requires both native foreground and visible document before resuming", () => {
  mountVideo();
  native("APP_STATE", { state: "background" });
  visibility(true);
  native("APP_STATE", { state: "active" });
  expect(play).toHaveBeenCalledTimes(1);
  visibility(false);
  expect(play).toHaveBeenCalledTimes(2);
  native("APP_STATE", { state: "background" });
  visibility(true);
  visibility(false);
  expect(play).toHaveBeenCalledTimes(2);
});

it("starts after initial document visibility and avoids duplicate visibility bursts", () => {
  hidden = true;
  mountVideo();
  expect(play).not.toHaveBeenCalled();
  visibility(false);
  expect(play).toHaveBeenCalledTimes(1);
  visibility(false);
  expect(play).toHaveBeenCalledTimes(1);
});

it("permits a fresh bounded retry on unlock without reading its credential payload", async () => {
  play.mockRejectedValue(new Error("Blocked"));
  mountVideo();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  const payload = Object.defineProperty({}, "pin", {
    get() {
      throw new Error("Decorative video must not inspect credentials");
    },
  });
  native("UNLOCK_WITH_PIN", payload);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(play).toHaveBeenCalledTimes(6);
  expect(jest.getTimerCount()).toBe(0);
});

it("does not play under reduced motion and responds to preference changes", () => {
  reducedMotion = true;
  const { video, media } = mountVideo();
  expect(play).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  expect(media.style.opacity).toBe("0");
  reducedMotion = false;
  act(() => motion.dispatchEvent(new Event("change")));
  act(() => jest.advanceTimersByTime(0));
  expect(play).toHaveBeenCalledTimes(1);
  paused = false;
  fireEvent.playing(video);
  reducedMotion = true;
  act(() => motion.dispatchEvent(new Event("change")));
  expect(paused).toBe(true);
  expect(media.style.opacity).toBe("0");
  native("UNLOCK_WITH_PIN");
  native("APP_STATE", { state: "active" });
  expect(play).toHaveBeenCalledTimes(1);
});

it("restores the static fallback on a later pause or media error", () => {
  const { video, media } = mountVideo();
  paused = false;
  fireEvent.playing(video);
  paused = true;
  fireEvent.pause(video);
  expect(media.style.opacity).toBe("0");
  native("UNLOCK_WITH_PIN");
  fireEvent.error(video);
  expect(media.style.opacity).toBe("0");
  expect(jest.getTimerCount()).toBe(0);
});

it("cancels timers and listeners on unmount and rejects a stale promise", async () => {
  let resolvePlay: (() => void) | undefined;
  play.mockReturnValue(
    new Promise<void>((resolve) => {
      resolvePlay = resolve;
    }),
  );
  const { unmount } = mountVideo();
  unmount();
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => resolvePlay?.());
  visibility(true);
  visibility(false);
  expect(play).toHaveBeenCalledTimes(1);
  expect(paused).toBe(true);
});

it("does not let an old rejection cancel a newer foreground attempt", async () => {
  let rejectOld: ((reason: Error) => void) | undefined;
  play.mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => {
      rejectOld = reject;
    }),
  );
  const { video, media } = mountVideo();
  native("APP_STATE", { state: "background" });
  native("APP_STATE", { state: "active" });
  paused = false;
  fireEvent.playing(video);
  await act(async () => rejectOld?.(new Error("Old interruption")));
  expect(media.style.opacity).toBe("1");
  expect(play).toHaveBeenCalledTimes(2);
  expectNoTimers();
});

it("cancels StrictMode's abandoned setup before playback and keeps the retry budget bounded", async () => {
  play.mockRejectedValue(new Error("Blocked"));
  render(
    <StrictMode>
      <DecorativeAccountVideo />
    </StrictMode>,
  );
  expect(play).not.toHaveBeenCalled();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(play).toHaveBeenCalledTimes(3);
  expectNoTimers();
});
