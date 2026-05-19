import { makeAutoObservable } from "mobx";
import { log } from "@/utils";
import type QrlStore from "./qrlStore";
import type TokenStore from "./tokenStore";

// Empty observable shell. Populated in the NFT support phase (ERC-721 +
// ERC-1155 detection, gallery, transfer). Constructed with refs to the
// other two stores so future actions can read wallet state and reuse
// the token transaction-status surface.
class NftStore {
  constructor(
    // Held for the upcoming ERC-721/1155 actions (read activeAccount,
    // qrlConnection, signing helpers, transaction status).
    private qrlStore: QrlStore,
    // Held so NFT actions can co-exist with the token transaction-status
    // surface where shared (e.g. refresh-after-transfer hooks).
    private tokenStore: TokenStore,
  ) {
    makeAutoObservable(this);
    // Touch the refs so the unused-parameter lint stays happy while the
    // shell is empty. Removed once real fields/actions land.
    void this.qrlStore;
    void this.tokenStore;
    log("NftStore initialized");
  }
}

export default NftStore;
