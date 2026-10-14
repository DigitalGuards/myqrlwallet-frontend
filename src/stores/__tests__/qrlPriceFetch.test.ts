jest.mock("@/config", () => ({
  QRL_PROVIDER: {},
  EXPLORER_BASE: "https://explorer.invalid",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({ deriveHexSeedAsync: jest.fn() }));
jest.mock("@/utils/storage", () => ({ StorageUtil: {} }));
jest.mock("@/utils/web3", () => ({ getQrlWeb3: jest.fn() }));

import { runInAction } from "mobx";
import QrlStore from "../qrlStore";

const MAX_BYTES = 64 * 1024;
const validOverview = { currentPrice: 3.25, priceChange24h: -4.5 };
const validBody = JSON.stringify(validOverview);
const encoder = new TextEncoder();
let store: QrlStore;
let fetchMock: jest.SpiedFunction<typeof fetch>;

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise resolver unavailable");
  };
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function streamedResponse(chunks: Uint8Array[], headers?: HeadersInit) {
  let index = 0;
  const cancel = jest.fn();
  const pull = jest.fn(
    (controller: ReadableStreamDefaultController<Uint8Array>) => {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  );
  const body = new ReadableStream<Uint8Array>(
    { pull, cancel },
    { highWaterMark: 0 },
  );
  return { response: new Response(body, { headers }), body, pull, cancel };
}

function requestSignal(): AbortSignal {
  const signal = fetchMock.mock.calls[0]?.[1]?.signal;
  if (!signal) throw new Error("Price request has no abort signal");
  return signal;
}

function expectOldPrice() {
  expect(store.qrlPrice).toBe(2);
  expect(store.qrlPriceChange24h).toBe(7);
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
  fetchMock = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected fetch"));
  store = new QrlStore();
  runInAction(() => {
    store.qrlPrice = 2;
    store.qrlPriceChange24h = 7;
  });
  await jest.advanceTimersByTimeAsync(0);
});

afterEach(() => {
  const pendingTimers = jest.getTimerCount();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  expect(pendingTimers).toBe(0);
});

it("updates both values from a valid streamed overview with other explorer fields", async () => {
  const body = JSON.stringify({ ...validOverview, blockHeight: 123 });
  const stream = streamedResponse([
    encoder.encode(body.slice(0, 20)),
    encoder.encode(body.slice(20)),
  ]);
  fetchMock.mockResolvedValueOnce(stream.response);

  await store.fetchQrlPrice();

  expect(fetchMock).toHaveBeenCalledWith(
    "https://explorer.invalid/api/overview",
    {
      signal: requestSignal(),
    },
  );
  expect(requestSignal()).toBeInstanceOf(AbortSignal);
  expect(store.qrlPrice).toBe(3.25);
  expect(store.qrlPriceChange24h).toBe(-4.5);
  expect(stream.body.locked).toBe(false);
});

it("aborts stalled response headers at ten seconds, preserves prices and permits a retry", async () => {
  fetchMock.mockImplementationOnce(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Missing abort signal");
        signal.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      }),
  );

  const pending = store.fetchQrlPrice();
  const signal = requestSignal();
  await jest.advanceTimersByTimeAsync(9_999);
  expect(signal.aborted).toBe(false);
  expectOldPrice();
  await jest.advanceTimersByTimeAsync(1);
  await pending;

  expect(signal.aborted).toBe(true);
  expectOldPrice();
  fetchMock.mockResolvedValueOnce(new Response(validBody));
  await store.fetchQrlPrice();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(store.qrlPrice).toBe(3.25);
});

it("keeps the original ten-second deadline while reading a stalled body", async () => {
  fetchMock.mockImplementationOnce(
    (_input, init) =>
      new Promise<Response>((resolve) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Missing abort signal");
        setTimeout(() => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('{"currentPrice":3.25,'));
              signal.addEventListener(
                "abort",
                () => {
                  controller.error(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            },
          });
          resolve(new Response(body));
        }, 4_000);
      }),
  );

  const pending = store.fetchQrlPrice();
  await jest.advanceTimersByTimeAsync(9_999);
  expect(requestSignal().aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await pending;

  expect(requestSignal().aborted).toBe(true);
  expectOldPrice();
});

it("rejects an oversized Content-Length before reading the body", async () => {
  const stream = streamedResponse([encoder.encode(validBody)], {
    "Content-Length": String(MAX_BYTES + 1),
  });
  fetchMock.mockResolvedValueOnce(stream.response);

  await store.fetchQrlPrice();

  expectOldPrice();
  expect(stream.pull).not.toHaveBeenCalled();
  expect(requestSignal().aborted).toBe(true);
});

it.each([undefined, "1", "invalid"])(
  "stops and cancels a stream above the cap with Content-Length %s",
  async (contentLength) => {
    const headers = new Headers();
    if (contentLength !== undefined)
      headers.set("Content-Length", contentLength);
    const stream = streamedResponse(
      [
        encoder.encode(validBody.padEnd(MAX_BYTES)),
        encoder.encode(" "),
        encoder.encode("unread"),
      ],
      headers,
    );
    fetchMock.mockResolvedValueOnce(stream.response);

    await store.fetchQrlPrice();

    expectOldPrice();
    expect(stream.pull).toHaveBeenCalledTimes(2);
    expect(stream.cancel).toHaveBeenCalledTimes(1);
    expect(stream.body.locked).toBe(false);
  },
);

it("counts bytes for a single oversized chunk containing multibyte text", async () => {
  const body = JSON.stringify({
    ...validOverview,
    extra: "\u20ac".repeat(MAX_BYTES / 2),
  });
  expect(body.length).toBeLessThan(MAX_BYTES);
  const stream = streamedResponse([encoder.encode(body)]);
  fetchMock.mockResolvedValueOnce(stream.response);

  await store.fetchQrlPrice();

  expectOldPrice();
  expect(stream.cancel).toHaveBeenCalledTimes(1);
});

it("accepts a valid response exactly at the byte cap", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(validBody.padEnd(MAX_BYTES), {
      headers: { "Content-Length": String(MAX_BYTES) },
    }),
  );

  await store.fetchQrlPrice();

  expect(store.qrlPrice).toBe(3.25);
  expect(store.qrlPriceChange24h).toBe(-4.5);
});

it("releases the in-flight guard when the request setup throws", async () => {
  const setupFailure = jest
    .spyOn(globalThis, "AbortController")
    .mockImplementationOnce(() => {
      throw new Error("AbortController unavailable");
    });
  await store.fetchQrlPrice();
  expect(fetchMock).not.toHaveBeenCalled();
  expectOldPrice();
  setupFailure.mockRestore();

  fetchMock.mockResolvedValueOnce(new Response(validBody));
  await store.fetchQrlPrice();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(store.qrlPrice).toBe(3.25);
});

it("ignores invalid JSON and permits the next request", async () => {
  fetchMock.mockResolvedValueOnce(new Response('{"currentPrice":3.25,'));
  await store.fetchQrlPrice();
  expectOldPrice();

  fetchMock.mockResolvedValueOnce(new Response(validBody));
  await store.fetchQrlPrice();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(store.qrlPrice).toBe(3.25);
});

it.each([
  '{"currentPrice":0,"priceChange24h":2}',
  '{"currentPrice":-1,"priceChange24h":2}',
  '{"currentPrice":1000000,"priceChange24h":2}',
  '{"currentPrice":1000001,"priceChange24h":2}',
  '{"currentPrice":1e400,"priceChange24h":2}',
  '{"currentPrice":-1e400,"priceChange24h":2}',
  '{"currentPrice":NaN,"priceChange24h":2}',
  '{"currentPrice":3,"priceChange24h":-100.01}',
  '{"currentPrice":3,"priceChange24h":10000.01}',
  '{"currentPrice":3,"priceChange24h":1e400}',
  '{"currentPrice":3,"priceChange24h":-1e400}',
  '{"currentPrice":3,"priceChange24h":NaN}',
  '{"currentPrice":"3","priceChange24h":2}',
  '{"currentPrice":3,"priceChange24h":"2"}',
  '{"currentPrice":null,"priceChange24h":2}',
  '{"currentPrice":3,"priceChange24h":null}',
  '{"currentPrice":true,"priceChange24h":2}',
  '{"currentPrice":3}',
  '{"priceChange24h":2}',
  "{}",
  "null",
  "[]",
  "3",
])("preserves both values for invalid numbers or shape: %s", async (body) => {
  fetchMock.mockResolvedValueOnce(new Response(body));
  await store.fetchQrlPrice();
  expectOldPrice();
});

it.each([
  { currentPrice: 0.000001, priceChange24h: -100 },
  { currentPrice: 999999.99, priceChange24h: 10000 },
  { currentPrice: 1, priceChange24h: 0 },
])("accepts valid range boundaries: %j", async (overview) => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(overview)));
  await store.fetchQrlPrice();
  expect(store.qrlPrice).toBe(overview.currentPrice);
  expect(store.qrlPriceChange24h).toBe(overview.priceChange24h);
});

it("ignores HTTP errors and empty bodies", async () => {
  fetchMock.mockResolvedValueOnce(new Response(validBody, { status: 503 }));
  await store.fetchQrlPrice();
  expectOldPrice();

  fetchMock.mockResolvedValueOnce(new Response(null));
  await store.fetchQrlPrice();
  expectOldPrice();
});

it("preserves prices after a stream error and permits a retry", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("Connection closed"));
    },
  });
  fetchMock.mockResolvedValueOnce(new Response(body));
  await store.fetchQrlPrice();
  expectOldPrice();
  expect(body.locked).toBe(false);

  fetchMock.mockResolvedValueOnce(new Response(validBody));
  await store.fetchQrlPrice();
  expect(store.qrlPrice).toBe(3.25);
});

it("prevents overlapping requests through headers and body reads, then allows a refresh", async () => {
  const headers = deferred<Response>();
  fetchMock.mockReturnValueOnce(headers.promise);
  const pending = store.fetchQrlPrice();
  await store.fetchQrlPrice();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const reading = deferred<undefined>();
  const controllerReady =
    deferred<ReadableStreamDefaultController<Uint8Array>>();
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controllerReady.resolve(controller);
      },
      pull() {
        reading.resolve(undefined);
      },
    },
    { highWaterMark: 0 },
  );
  headers.resolve(new Response(body));
  await reading.promise;
  await store.fetchQrlPrice();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const controller = await controllerReady.promise;
  controller.enqueue(encoder.encode(validBody));
  controller.close();
  await pending;
  expect(store.qrlPrice).toBe(3.25);

  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ currentPrice: 4, priceChange24h: 5 })),
  );
  await store.fetchQrlPrice();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(store.qrlPrice).toBe(4);
  expect(store.qrlPriceChange24h).toBe(5);
});
