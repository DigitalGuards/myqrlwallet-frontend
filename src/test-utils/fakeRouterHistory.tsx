/**
 * A tiny stand-in for the router's history, used by the navigation tests
 * (jest cannot load the ESM-only react-router). It models entries, an index
 * into them, and the difference between pushing, replacing, and going back
 * or forward, which it also reports as react-router's navigation type.
 * Components read it through the same hook names react-router exports, so
 * the components under test stay unmodified.
 *
 * This file is a shared helper: jest collects `*.test.*` files only.
 */
import { useSyncExternalStore } from "react";
import { act } from "@testing-library/react";

export interface FakeEntry {
  pathname: string;
  search: string;
  state: unknown;
  key: string;
}

export interface FakeNavigateOptions {
  replace?: boolean;
  state?: unknown;
}

/** How the last move happened, as react-router's useNavigationType says. */
export type FakeNavigationType = "POP" | "PUSH" | "REPLACE";

const listeners = new Set<() => void>();
let entries: FakeEntry[] = [];
let index = 0;
let keyCounter = 0;
let action: FakeNavigationType = "POP";

function makeEntry(url: string, state: unknown): FakeEntry {
  const [pathname, rawSearch] = url.split("?");
  keyCounter += 1;
  return {
    pathname: pathname || "/",
    search: rawSearch ? `?${rawSearch}` : "",
    state,
    key: `entry-${keyCounter}`,
  };
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentEntry(): FakeEntry {
  const entry = entries[index];
  if (!entry) throw new Error("Fake history is empty: call reset() first");
  return entry;
}

function go(delta: number) {
  const next = Math.min(Math.max(index + delta, 0), entries.length - 1);
  if (next === index) return;
  index = next;
  action = "POP";
  emit();
}

function navigate(to: string | number, options: FakeNavigateOptions = {}) {
  if (typeof to === "number") {
    go(to);
    return;
  }
  const entry = makeEntry(to, options.state ?? null);
  if (options.replace) {
    entries[index] = entry;
    action = "REPLACE";
  } else {
    entries = [...entries.slice(0, index + 1), entry];
    index = entries.length - 1;
    action = "PUSH";
  }
  emit();
}

/** Control surface for the tests. */
export const fakeHistory = {
  reset(url = "/") {
    entries = [makeEntry(url, null)];
    index = 0;
    keyCounter = 0;
    action = "POP";
    emit();
  },
  /**
   * Browser history as a page load finds it: these entries, showing the one
   * at `at`. A reload keeps the entries; the in-app state starts over.
   */
  load(urls: readonly string[], at = urls.length - 1) {
    keyCounter = 0;
    entries = urls.map((url) => makeEntry(url, null));
    index = at;
    action = "POP";
    emit();
  },
  /** The last move: a push, a replace, or a step back or forward. */
  action: () => action,
  current: currentEntry,
  length: () => entries.length,
  index: () => index,
  /** A navigation from outside the components, such as Android back. */
  navigate(to: string, options?: FakeNavigateOptions) {
    act(() => {
      navigate(to, options);
    });
  },
  /** Browser Back. */
  back() {
    act(() => {
      go(-1);
    });
  },
  /** Browser Forward. */
  forward() {
    act(() => {
      go(1);
    });
  },
};

/** Subscribing read of the current entry, for components and shells. */
export function useFakeLocation(): FakeEntry {
  return useSyncExternalStore(subscribe, currentEntry, currentEntry);
}

function useFakeNavigate() {
  return navigate;
}

function useFakeNavigationType(): FakeNavigationType {
  useFakeLocation();
  return action;
}

function useFakeParams(): Record<string, string> {
  const { pathname } = useFakeLocation();
  const match = /^\/nft\/([^/]+)\/([^/]+)$/.exec(pathname);
  const [, contractAddress, tokenId] = match ?? [];
  if (!contractAddress || !tokenId) return {};
  return {
    contractAddress: decodeURIComponent(contractAddress),
    tokenId: decodeURIComponent(tokenId),
  };
}

type SearchParamsInit =
  | URLSearchParams
  | ((previous: URLSearchParams) => URLSearchParams);

function useFakeSearchParams(): [
  URLSearchParams,
  (init: SearchParamsInit, options?: FakeNavigateOptions) => void,
] {
  const location = useFakeLocation();
  const params = new URLSearchParams(location.search);
  const setSearchParams = (
    init: SearchParamsInit,
    options: FakeNavigateOptions = {},
  ) => {
    const next =
      typeof init === "function"
        ? init(new URLSearchParams(location.search))
        : init;
    const search = next.toString();
    navigate(
      `${location.pathname}${search ? `?${search}` : ""}`,
      options,
    );
  };
  return [params, setSearchParams];
}

/** The subset of react-router the NFT views, Back and RouteMonitor use. */
export function fakeRouterModule() {
  return {
    useNavigate: useFakeNavigate,
    useLocation: useFakeLocation,
    useNavigationType: useFakeNavigationType,
    useParams: useFakeParams,
    useSearchParams: useFakeSearchParams,
  };
}
