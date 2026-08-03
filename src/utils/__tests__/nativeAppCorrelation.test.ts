import {
  confirmWalletCleared,
  getCurrentNativeDocumentId,
  sendDAppDisconnectResponse,
  sendPinVerified,
} from "../nativeApp";

const FIRST_ID = "00112233445566778899aabbccddeeff";
const SECOND_ID = "ffeeddccbbaa99887766554433221100";
const CHANNEL_ID = "00112233-4455-6677-8899-aabbccddeeff";
const DOCUMENT_ID = getCurrentNativeDocumentId();

describe("native bridge correlation envelopes", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let postMessage: jest.Mock;

  beforeEach(() => {
    postMessage = jest.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        ReactNativeWebView: { postMessage },
      }),
    });
  });

  afterAll(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("echoes each PIN request id without cross-request substitution", () => {
    expect(sendPinVerified(FIRST_ID, true)).toBe(true);
    expect(sendPinVerified(SECOND_ID, false, "Incorrect PIN")).toBe(true);

    expect(postMessage.mock.calls.map(([wire]) => JSON.parse(wire))).toEqual([
      {
        type: "PIN_VERIFIED",
        payload: { requestId: FIRST_ID, success: true, documentId: DOCUMENT_ID },
      },
      {
        type: "PIN_VERIFIED",
        payload: {
          requestId: SECOND_ID,
          success: false,
          error: "Incorrect PIN",
          documentId: DOCUMENT_ID,
        },
      },
    ]);
  });

  it("uses exact correlated clear and durable-disconnect response schemas", () => {
    expect(confirmWalletCleared(FIRST_ID, true)).toBe(true);
    expect(
      sendDAppDisconnectResponse(
        SECOND_ID,
        CHANNEL_ID,
        false,
        "Session teardown was not confirmed",
      ),
    ).toBe(true);

    expect(postMessage.mock.calls.map(([wire]) => JSON.parse(wire))).toEqual([
      {
        type: "WALLET_CLEARED",
        payload: { requestId: FIRST_ID, success: true, documentId: DOCUMENT_ID },
      },
      {
        type: "DAPP_DISCONNECT_RESPONSE",
        payload: {
          requestId: SECOND_ID,
          channelId: CHANNEL_ID,
          success: false,
          error: "Session teardown was not confirmed",
          documentId: DOCUMENT_ID,
        },
      },
    ]);
  });

  it("does not emit malformed correlation or channel identifiers", () => {
    expect(sendPinVerified("stale", true)).toBe(false);
    expect(confirmWalletCleared(FIRST_ID.toUpperCase(), true)).toBe(false);
    expect(sendDAppDisconnectResponse(FIRST_ID, "wrong-channel", true)).toBe(
      false,
    );
    expect(postMessage).not.toHaveBeenCalled();
  });
});
