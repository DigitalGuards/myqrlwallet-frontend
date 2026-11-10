import { observable, runInAction } from "mobx";
import type { BlockchainSelection } from "@/utils/storage/storage";
import { assetServiceError } from "@/i18n/assetMessage";
import { captureSigningContext } from "../signingContext";

const ACCOUNT = `Q${"1".repeat(128)}`;
const MESSAGE = "Wallet changed while preparing the NFT transfer";

class Provider {
  constructor(readonly id: number) {}
}

interface FakeStore {
  activeAccount: { accountAddress: string };
  activeAccountSource: string;
  qrlConnection: { blockchain: BlockchainSelection };
  qrlInstance: Provider;
}

function store(): FakeStore {
  const state: FakeStore = {
    activeAccount: { accountAddress: ACCOUNT },
    activeAccountSource: "seed",
    qrlConnection: { blockchain: "TEST_NET" },
    qrlInstance: new Provider(1),
  };
  return observable(
    state,
    {
      activeAccount: observable.struct,
      qrlConnection: observable.struct,
      qrlInstance: observable.struct,
    },
  );
}

describe("captureSigningContext", () => {
  it("passes while nothing changes", () => {
    const context = captureSigningContext(store(), { message: MESSAGE });
    expect(() => { context.assertUnchanged(); }).not.toThrow();
  });

  it.each([
    ["account", (s: FakeStore) => { s.activeAccount = { accountAddress: `Q${"2".repeat(128)}` }; }],
    ["source", (s: FakeStore) => { s.activeAccountSource = "extension"; }],
    ["network", (s: FakeStore) => { s.qrlConnection = { blockchain: "MAIN_NET" }; }],
    ["provider", (s: FakeStore) => { s.qrlInstance = new Provider(2); }],
  ])("throws the caller's message when the %s changes", (_name, change) => {
    const s = store();
    const context = captureSigningContext(s, { message: MESSAGE });
    runInAction(() => { change(s); });
    expect(() => { context.assertUnchanged(); }).toThrow(MESSAGE);
  });

  it("throws at once when the caller's render differs from the store", () => {
    expect(() =>
      captureSigningContext(store(), { message: MESSAGE, account: `Q${"2".repeat(128)}` }),
    ).toThrow(MESSAGE);
    expect(() =>
      captureSigningContext(store(), { message: MESSAGE, blockchain: "MAIN_NET" }),
    ).toThrow(MESSAGE);
    expect(() =>
      captureSigningContext(store(), { message: MESSAGE, account: ACCOUNT, blockchain: "TEST_NET" }),
    ).not.toThrow();
  });
});

describe("assertNetwork", () => {
  it("passes the captured network and throws the given message on another", () => {
    const context = captureSigningContext(store(), { message: MESSAGE });
    expect(() => { context.assertNetwork("TEST_NET"); }).not.toThrow();
    expect(() => { context.assertNetwork("MAIN_NET"); }).toThrow(MESSAGE);
  });

  it("compares the array form by value", () => {
    const s = store();
    s.qrlConnection = { blockchain: ["TEST_NET"] };
    const context = captureSigningContext(s, { message: MESSAGE });
    expect(() => { context.assertNetwork(["TEST_NET"]); }).not.toThrow();
    expect(() => { context.assertNetwork("TEST_NET"); }).not.toThrow();
    expect(() => { context.assertNetwork(["MAIN_NET"]); }).toThrow(MESSAGE);
  });
});

describe("wallet-changed messages", () => {
  it("map to the translated keys the screens already use", () => {
    expect(assetServiceError("Wallet changed while preparing the NFT transfer")).toEqual({
      key: "nfts:walletChanged",
    });
    expect(assetServiceError("Wallet changed while preparing token creation")).toEqual({
      key: "creation:walletChanged",
    });
  });
});
