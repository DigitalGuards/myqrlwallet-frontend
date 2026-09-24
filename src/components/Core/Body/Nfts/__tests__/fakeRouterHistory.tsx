/**
 * A tiny stand-in for the router's history, used by the NFT navigation
 * tests. It models the one thing those tests are about: entries, an
 * index into them, and the difference between pushing, replacing, and
 * going back or forward. Components read it through the same hook names
 * react-router exports, so the components under test stay unmodified.
 *
 * This file is a helper, not a suite (jest collects `*.test.*` only).
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

const listeners = new Set<() => void>();
let entries: FakeEntry[] = [];
let index = 0;
let keyCounter = 0;

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
  } else {
    entries = [...entries.slice(0, index + 1), entry];
    index = entries.length - 1;
  }
  emit();
}

/** Control surface for the tests. */
export const fakeHistory = {
  reset(url = "/") {
    entries = [makeEntry(url, null)];
    index = 0;
    keyCounter = 0;
    emit();
  },
  current: currentEntry,
  length: () => entries.length,
  index: () => index,
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

/** The subset of react-router the NFT views use. */
export function fakeRouterModule() {
  return {
    useNavigate: useFakeNavigate,
    useLocation: useFakeLocation,
    useParams: useFakeParams,
    useSearchParams: useFakeSearchParams,
  };
}
