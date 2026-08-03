export {};

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

describe("native WebView document binding", () => {
  let eventTarget: EventTarget;
  let postMessage: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    eventTarget = new EventTarget();
    postMessage = jest.fn();
    Object.assign(eventTarget, { ReactNativeWebView: { postMessage } });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: eventTarget,
    });
  });

  afterAll(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("binds READY and its challenge echo to one fresh document id", async () => {
    const nativeApp = await import("../nativeApp");
    const documentId = nativeApp.getCurrentNativeDocumentId();
    expect(documentId).toMatch(/^[0-9a-f]{32}$/);

    expect(nativeApp.notifyWebAppReady()).toBe(true);
    expect(nativeApp.confirmWebDocumentReady("11".repeat(16))).toBe(true);

    expect(postMessage.mock.calls.map(([wire]) => JSON.parse(wire))).toEqual([
      { type: "WEB_APP_READY", payload: { documentId } },
      {
        type: "WEB_DOCUMENT_READY",
        payload: { documentId, challengeId: "11".repeat(16) },
      },
    ]);
  });

  it("drops delayed challenge and unlock messages from an old document", async () => {
    const nativeApp = await import("../nativeApp");
    const documentId = nativeApp.getCurrentNativeDocumentId();
    const oldDocumentId = documentId === "22".repeat(16)
      ? "33".repeat(16)
      : "22".repeat(16);
    const observed: string[] = [];
    const unsubscribe = nativeApp.subscribeToNativeMessages((message) => {
      observed.push(message.type);
    });

    for (const detail of [
      {
        type: "WEB_DOCUMENT_CHALLENGE",
        payload: { documentId: oldDocumentId, challengeId: "44".repeat(16) },
      },
      {
        type: "UNLOCK_WITH_PIN",
        payload: { documentId: oldDocumentId, pin: "1234" },
      },
      {
        type: "UNLOCK_WITH_PIN",
        payload: { documentId, pin: "1234" },
      },
      {
        type: "WEB_DOCUMENT_CHALLENGE",
        payload: { documentId, challengeId: "55".repeat(16) },
      },
    ]) {
      eventTarget.dispatchEvent(new CustomEvent("nativeMessage", { detail }));
    }

    expect(observed).toEqual(["UNLOCK_WITH_PIN", "WEB_DOCUMENT_CHALLENGE"]);
    unsubscribe();
  });

  it("generates a different binding for a new full document module", async () => {
    const first = await import("../nativeApp");
    const firstId = first.getCurrentNativeDocumentId();
    first.notifyWebAppReady();

    jest.resetModules();
    const second = await import("../nativeApp");
    const secondId = second.getCurrentNativeDocumentId();
    second.notifyWebAppReady();

    expect(secondId).not.toBe(firstId);
    expect(postMessage.mock.calls.map(([wire]) => JSON.parse(wire))).toEqual([
      { type: "WEB_APP_READY", payload: { documentId: firstId } },
      { type: "WEB_APP_READY", payload: { documentId: secondId } },
    ]);
  });
});
