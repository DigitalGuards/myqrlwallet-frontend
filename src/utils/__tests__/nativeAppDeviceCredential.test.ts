const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

describe("native device credential request protocol", () => {
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
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "MyQRLWallet test WebView" },
    });
  });

  afterAll(() => {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalNavigator)
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  });

  async function waitForPostedMessage(): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const posted = postMessage.mock.calls[0]?.[0];
      if (typeof posted === "string") return posted;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error("Native bridge message was not posted");
  }

  it("correlates the native persistence acknowledgement without logging the credential", async () => {
    const { requestNativeDeviceCredential } = await import("../nativeApp");
    const candidate = "ab".repeat(32);
    const request = requestNativeDeviceCredential({
      createIfMissing: true,
      candidate,
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(postMessage.mock.calls[0]?.[0] as string);
    expect(sent).toMatchObject({
      type: "DEVICE_CREDENTIAL_REQUEST",
      payload: { createIfMissing: true, candidate },
    });

    eventTarget.dispatchEvent(
      new CustomEvent("nativeMessage", {
        detail: {
          type: "DEVICE_CREDENTIAL_RESPONSE",
          payload: {
            documentId: sent.payload.documentId,
            requestId: sent.payload.requestId,
            credential: candidate,
          },
        },
      }),
    );
    await expect(request).resolves.toBe(candidate);
  });

  it("reports a missing credential without asking native to create one", async () => {
    const { requestNativeDeviceCredential } = await import("../nativeApp");
    const request = requestNativeDeviceCredential({ createIfMissing: false });
    const sent = JSON.parse(postMessage.mock.calls[0]?.[0] as string);
    expect(sent.payload).not.toHaveProperty("candidate");
    eventTarget.dispatchEvent(
      new CustomEvent("nativeMessage", {
        detail: {
          type: "DEVICE_CREDENTIAL_RESPONSE",
          payload: {
            documentId: sent.payload.documentId,
            requestId: sent.payload.requestId,
            error: "NOT_FOUND",
          },
        },
      }),
    );
    await expect(request).resolves.toBeNull();
  });

  it("binds a seed-backup acknowledgement to its revision and ciphertext hash", async () => {
    const { hashEncryptedSeed, notifySeedStored } =
      await import("../nativeApp");
    const encryptedSeed = '{"version":"pin_v5","encryptedData":"abcd"}';
    const ciphertextHash = await hashEncryptedSeed(encryptedSeed);
    const request = notifySeedStored({
      address: `Q${"12".repeat(20)}`,
      encryptedSeed,
      blockchain: "TEST_NET",
      revision: 9,
    });
    const sent = JSON.parse(await waitForPostedMessage());
    expect(sent).toMatchObject({
      type: "SEED_STORED",
      payload: { revision: 9, ciphertextHash },
    });

    eventTarget.dispatchEvent(
      new CustomEvent("nativeMessage", {
        detail: {
          type: "SEED_STORED_RESPONSE",
          payload: {
            documentId: sent.payload.documentId,
            requestId: sent.payload.requestId,
            success: true,
            revision: 9,
            ciphertextHash,
          },
        },
      }),
    );
    await expect(request).resolves.toEqual({ revision: 9, ciphertextHash });
  });

  it("rejects an acknowledgement for a different seed revision", async () => {
    const { notifySeedStored } = await import("../nativeApp");
    const request = notifySeedStored({
      address: `Q${"34".repeat(20)}`,
      encryptedSeed: "ciphertext",
      blockchain: "MAIN_NET",
      revision: 3,
    });
    const sent = JSON.parse(await waitForPostedMessage());

    eventTarget.dispatchEvent(
      new CustomEvent("nativeMessage", {
        detail: {
          type: "SEED_STORED_RESPONSE",
          payload: {
            documentId: sent.payload.documentId,
            requestId: sent.payload.requestId,
            success: true,
            revision: 2,
            ciphertextHash: sent.payload.ciphertextHash,
          },
        },
      }),
    );
    await expect(request).rejects.toThrow(/different seed backup revision/);
  });

  it("invalidates a native-injected PIN on every app lifecycle transition", async () => {
    const {
      clearNativeInjectedPinForAppState,
      getNativeInjectedPin,
      setNativeInjectedPin,
    } = await import("../nativeApp");

    setNativeInjectedPin("1234");
    expect(getNativeInjectedPin()).toBe("1234");
    clearNativeInjectedPinForAppState();
    expect(getNativeInjectedPin()).toBeNull();
  });
});
