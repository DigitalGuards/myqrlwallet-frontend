import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "../bytes";
import {
  computeTypedDataDigest,
  encodeType,
  hashStruct,
  typeHash,
  typedDataSchemeVersion,
} from "../typedData";
import {
  recognizeVaultRequest,
  vaultApprovalBlocked,
  vaultUint,
  VAULT_TX_FIELDS,
  VAULT_MAX_UINT256,
} from "../quantaVault";
import {
  decodeVaultAbi,
  decodeVaultCall,
  decodeVaultMultiSend,
  vaultRoleLabel,
  type VaultAbiType,
  type VaultAbiValue,
} from "../quantaVaultCalldata";
import { VAULT_SELECTORS, VAULT_ROLES } from "../quantaVaultSelectors";
import { isQuantaVaultOrigin, QUANTA_VAULT_CONFIG } from "@/config/quantaVault";
import {
  vaultCalldata,
  vaultPayload,
  vaultSchemeVectors,
  vaultTestAddress,
} from "./quantaVaultFixtures";
import batchVectors from "../__fixtures__/quantaVault/multi-send.json";
import calldataVectors from "../__fixtures__/quantaVault/calldata.json";
import selectors from "../__fixtures__/quantaVault/selectors.json";
import nested from "../__fixtures__/quantaVault/nested-vaults.json";
import proposals from "../__fixtures__/quantaVault/proposals.json";
import timelock from "../__fixtures__/quantaVault/timelock.json";
import timelockVault from "../__fixtures__/quantaVault/timelock-vault.json";

function normalized(value: VaultAbiValue): unknown {
  if (typeof value === "bigint") return value.toString();
  return typeof value === "string" ? value : value.map(normalized);
}
function call(data: string, operation = 0n, to = vaultTestAddress) {
  return { to, value: 0n, data, operation };
}
function word(value: bigint): string {
  return value.toString(16).padStart(128, "0");
}
function replaceWord(data: string, index: number, value: bigint): string {
  const start = 10 + index * 128;
  return data.slice(0, start) + word(value) + data.slice(start + 128);
}

describe("QuantaVault protocol parity", () => {
  it.each(vaultSchemeVectors)(
    "recognizes and preserves every hash in $label",
    (vector) => {
      const payload = vaultPayload(vector.label);
      expect(recognizeVaultRequest(payload)?.kind).toBe(payload.primaryType);
      expect(typedDataSchemeVersion(payload)).toBe(vector.schemeVersion);
      expect(encodeType(payload.primaryType, payload.types)).toBe(
        vector.encodeTypeString,
      );
      expect(bytesToHex(typeHash(payload.primaryType, payload.types))).toBe(
        vector.typeHashHex,
      );
      expect(
        bytesToHex(hashStruct("QRLDomain", payload.domain, payload.types)),
      ).toBe(vector.domainHashHex);
      expect(
        bytesToHex(
          hashStruct(payload.primaryType, payload.message, payload.types),
        ),
      ).toBe(vector.messageHashHex);
      expect(bytesToHex(computeTypedDataDigest(payload))).toBe(
        vector.digestHex,
      );
    },
  );

  it("recognizes the nested-vault opaque message vector without changing its digest", () => {
    const request = recognizeVaultRequest(nested.messagePayload);
    expect(request).toMatchObject({
      kind: "VaultMessage",
      vault: nested.inner,
      message: nested.outerDigest,
    });
    expect(bytesToHex(computeTypedDataDigest(nested.messagePayload))).toBe(
      nested.messageDigest,
    );
  });

  it.each(batchVectors.batches)("decodes SDK packed batch $label", (vector) => {
    expect(
      decodeVaultMultiSend(vector.encoded).map((entry) => ({
        ...entry,
        value: entry.value.toString(),
        operation: Number(entry.operation),
      })),
    ).toEqual(vector.transactions);
  });

  it.each(selectors.selectors)(
    "matches $contract.$name ABI fields and selector",
    (vector) => {
      const definition = VAULT_SELECTORS.find(
        (entry) => entry.selector === vector.selector,
      );
      expect(definition).toMatchObject({
        name: vector.name,
        selector: vector.selector,
      });
      expect(definition?.inputs.map((input) => input.type)).toEqual(
        vector.inputs.map((input) => input.type),
      );
      expect(
        bytesToHex(
          keccak_256(new TextEncoder().encode(vector.signature)).slice(0, 4),
        ),
      ).toBe(vector.selector);
    },
  );

  it.each(calldataVectors)(
    "renders every SDK argument for $method",
    (vector) => {
      const decoded = decodeVaultCall(call(vector.data), 1n);
      expect(decoded.status).toBe("decoded");
      expect(decoded.method).toBe(vector.method);
      expect(decoded.args.map((arg) => arg.type)).toEqual(vector.types);
      expect(decoded.args.map((arg) => normalized(arg.value))).toEqual(
        vector.values,
      );
    },
  );

  it.each(proposals.proposals)(
    "decodes the SDK proposal transaction $label",
    ({ tx, event }) => {
      const types: VaultAbiType[] = [
        "address",
        "uint256",
        "bytes",
        "uint8",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "address",
        "uint256",
        "uint256",
      ];
      expect(decodeVaultAbi(types, event.data).map(normalized)).toEqual([
        tx.to,
        tx.value,
        tx.data,
        String(tx.operation),
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        tx.nonce,
        tx.validUntil,
      ]);
    },
  );

  it.each(timelock.singles)(
    "decodes timelock dynamic bytes at $label",
    (vector) => {
      expect(
        decodeVaultAbi(
          ["address", "uint256", "bytes", "bytes32", "bytes32"],
          vector.encoding,
        ).map(normalized),
      ).toEqual([
        vector.target,
        vector.value,
        vector.data,
        vector.predecessor,
        vector.salt,
      ]);
    },
  );
  it.each(timelock.batches)("decodes timelock arrays at $label", (vector) => {
    expect(
      decodeVaultAbi(
        ["address[]", "uint256[]", "bytes[]", "bytes32", "bytes32"],
        vector.encoding,
      ).map(normalized),
    ).toEqual([
      vector.targets,
      vector.values,
      vector.payloads,
      vector.predecessor,
      vector.salt,
    ]);
  });

  it.each(["schedule", "execute"] as const)(
    "decodes the scheduled ownership call in the %s vector",
    (method) => {
      const decoded = decodeVaultCall(call(timelockVault.accept[method]), 1n);
      expect(decoded.children).toHaveLength(1);
      expect(decoded.children[0]).toMatchObject({
        to: timelockVault.registrar,
        method: "acceptOwnership",
        warnings: ["securityChange"],
      });
    },
  );
});

describe("exact vault recognition and approval policy", () => {
  it.each(["VaultTx", "QRLDomain"])(
    "checks every %s field name, type and position",
    (type) => {
      const original = vaultPayload().types[type];
      if (!original) throw new Error("Missing type");
      for (let i = 0; i < original.length; i++) {
        for (const alteration of ["name", "type", "order"] as const) {
          const payload = vaultPayload();
          payload.types[type] = original.map((field, index) =>
            index !== i
              ? field
              : alteration === "name"
                ? { ...field, name: `${field.name}Changed` }
                : alteration === "type"
                  ? { ...field, type: `${field.type}[]` }
                  : (original[(i + 1) % original.length] ?? field),
          );
          expect(recognizeVaultRequest(payload)).toBeNull();
        }
      }
    },
  );
  it("requires the exact approval and message schemas, domain version and type set", () => {
    const approval = vaultPayload("approval-empty");
    approval.types["VaultApproval"] = [
      { name: "tx", type: "VaultTx" },
      { name: "vault", type: "address" },
    ];
    expect(recognizeVaultRequest(approval)).toBeNull();
    const message = vaultPayload("empty-message");
    message.types["VaultMessage"] = [{ name: "message", type: "string" }];
    expect(recognizeVaultRequest(message)).toBeNull();
    for (const mutation of [
      "version",
      "domain",
      "unused",
      "primary",
      "name",
    ] as const) {
      const payload = vaultPayload();
      if (mutation === "version") payload.domain["version"] = "2";
      if (mutation === "domain") payload.domain["salt"] = "0x00";
      if (mutation === "unused") payload.types["Unused"] = [...VAULT_TX_FIELDS];
      if (mutation === "primary") payload.primaryType = "Other";
      if (mutation === "name") payload.domain["name"] = "Other";
      expect(recognizeVaultRequest(payload)).toBeNull();
    }
  });
  it.each(["baseGas", "gasPrice", "gasToken", "refundReceiver"])(
    "blocks nonzero %s for direct and nested approvals",
    (field) => {
      for (const label of ["empty-call", "approval-empty"]) {
        const payload = vaultPayload(label);
        const request = recognizeVaultRequest(payload);
        if (!request || request.kind === "VaultMessage")
          throw new Error("Missing transaction");
        const value =
          field === "gasToken" || field === "refundReceiver"
            ? vaultTestAddress
            : "0x1";
        if (label === "empty-call") payload.message[field] = value;
        else payload.message["tx"] = { ...request.tx, [field]: value };
        expect(vaultApprovalBlocked(payload)).toBe(true);
      }
    },
  );
  it("accepts exact integer encodings and leaves txGas informational", () => {
    for (const value of [0, 0n, "0", "0x0", "-0", "-0x0"])
      expect(vaultUint(value)).toBe(0n);
    for (const value of [
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      " 0",
      "01",
      true,
      VAULT_MAX_UINT256 + 1n,
    ])
      expect(() => vaultUint(value)).toThrow();
    const payload = vaultPayload();
    payload.message["txGas"] = VAULT_MAX_UINT256;
    expect(vaultApprovalBlocked(payload)).toBe(false);
  });
  it("compares self-reported origins exactly and accepts configured development", () => {
    for (const origin of QUANTA_VAULT_CONFIG.origins)
      expect(isQuantaVaultOrigin(`${origin}/vault`)).toBe(true);
    for (const origin of [
      "https://quantavault.io.attacker.example",
      "https://attacker.example/quantavault.io",
      "https://user@quantavault.io",
      "http://quantavault.io",
      "https://quantavault.io:444",
      "invalid",
      "",
    ])
      expect(isQuantaVaultOrigin(origin)).toBe(false);
  });
});

describe("calldata warnings and hostile encodings", () => {
  it.each([
    "addOwnerWithThreshold",
    "removeOwner",
    "swapOwner",
    "changeThreshold",
    "enableModule",
    "disableModule",
    "setGuard",
    "setModuleGuard",
    "setFallbackHandler",
    "transferOwnership",
    "acceptOwnership",
    "renounceOwnership",
  ])("flags security changes for %s", (method) => {
    expect(
      decodeVaultCall(call(vaultCalldata(method).data), 1n).warnings,
    ).toContain("securityChange");
  });
  it.each(["approveHash", "signMessage"])(
    "flags opaque approval through %s",
    (method) => {
      expect(
        decodeVaultCall(call(vaultCalldata(method).data), 1n).warnings,
      ).toContain("opaqueApproval");
    },
  );
  it("flags simulateAndRevert and module delegatecalls", () => {
    expect(
      decodeVaultCall(call(vaultCalldata("simulateAndRevert").data), 1n)
        .warnings,
    ).toContain("delegateCall");
    for (const method of [
      "execTransaction",
      "execTransactionFromModule",
      "execTransactionFromModuleReturnData",
    ]) {
      expect(
        decodeVaultCall(call(vaultCalldata(method).data), 1n).children[0]
          ?.warnings,
      ).toContain("delegateCall");
    }
  });
  it("retains DelegateCall warnings except for a chain-specific configured call-only target", () => {
    const data = vaultCalldata("multiSend").data;
    const config = {
      origins: [],
      multiSendCallOnly: { "1": [vaultTestAddress] },
    };
    expect(decodeVaultCall(call(data, 1n), 1n).warnings).toContain(
      "delegateCall",
    );
    const configured = decodeVaultCall(call(data, 1n), 1n, config);
    expect(configured.warnings).not.toContain("delegateCall");
    expect(configured.children[1]?.warnings).toContain("delegateCall");
    expect(decodeVaultCall(call(data, 1n), 2n, config).warnings).toContain(
      "delegateCall",
    );
    expect(
      decodeVaultCall(call(data, 1n, nested.outer), 1n, config).warnings,
    ).toContain("delegateCall");
    expect(
      decodeVaultCall(call(vaultCalldata("signMessage").data, 1n), 1n, config)
        .warnings,
    ).toContain("delegateCall");
    expect(decodeVaultCall(call(data, 1n), 1n, config, 1).warnings).toContain(
      "delegateCall",
    );
  });
  it.each(["grantRole", "revokeRole", "renounceRole"])(
    "labels %s and detects an open role",
    (method) => {
      expect(
        decodeVaultCall(
          call(replaceWord(vaultCalldata(method).data, 1, 0n)),
          1n,
        ).warnings,
      ).toContain("openRole");
      for (const [name, hash] of Object.entries(VAULT_ROLES)) {
        expect(vaultRoleLabel(hash)).toBe(name);
        if (name !== "DEFAULT_ADMIN")
          expect(
            bytesToHex(keccak_256(new TextEncoder().encode(`${name}_ROLE`))),
          ).toBe(hash);
      }
    },
  );
  it("keeps unknown bytes and warns at the expansion boundary", () => {
    expect(decodeVaultCall(call("0xdeadbeef1234", 1n), 1n)).toMatchObject({
      status: "unknown",
      data: "0xdeadbeef1234",
      warnings: ["delegateCall", "unknownCalldata"],
    });
    const decoded = decodeVaultCall(
      call(vaultCalldata("schedule").data),
      1n,
      QUANTA_VAULT_CONFIG,
      1,
    );
    expect(decoded.children).toEqual([]);
    expect(decoded.warnings).toContain("depthLimit");
    expect(decoded.args.find((arg) => arg.name === "data")?.value).toBe(
      vaultCalldata("transferOwnership").data.slice(0, 10) +
        vaultTestAddress.slice(1),
    );
  });
  it("rejects truncated, overlapping, oversized, padded and trailing ABI inputs", () => {
    const data = vaultCalldata("signMessage").data;
    for (const malformed of [
      data.slice(0, -2),
      data + "00",
      replaceWord(data, 0, 0n),
      replaceWord(data, 0, 65n),
      replaceWord(data, 0, 1n << 511n),
      replaceWord(data, 1, 1n << 511n),
      replaceWord(data, 1, 63n),
    ]) {
      expect(decodeVaultCall(call(malformed), 1n)).toMatchObject({
        status: "invalid",
        data: malformed,
        warnings: ["invalidCalldata"],
      });
    }
    expect(
      decodeVaultCall(
        call(replaceWord(vaultCalldata("transfer").data, 1, 1n << 256n)),
        1n,
      ).status,
    ).toBe("invalid");
    expect(
      decodeVaultCall(
        call(
          replaceWord(vaultCalldata("execTransactionFromModule").data, 3, 256n),
        ),
        1n,
      ).status,
    ).toBe("invalid");
    expect(
      decodeVaultCall(
        call(replaceWord(vaultCalldata("cancel").data, 0, 1n)),
        1n,
      ).status,
    ).toBe("invalid");
    const unequal = timelock.batches.find(
      (entry) => entry.label === "unequal-hash-inputs",
    );
    if (!unequal) throw new Error("Missing unequal fixture");
    expect(
      decodeVaultCall(
        call(
          vaultCalldata("executeBatch").selector + unequal.encoding.slice(2),
        ),
        1n,
      ).status,
    ).toBe("invalid");
  });
  it("rejects every partial batch header and incomplete data without returning a partial list", () => {
    for (let bytes = 1; bytes < 193; bytes++)
      expect(() => decodeVaultMultiSend(`0x${"00".repeat(bytes)}`)).toThrow();
    const entry = `00${vaultTestAddress.slice(1)}${word(0n)}`;
    for (const data of [
      `0x${entry}${word(2n)}ff`,
      `0x${entry}${word(1n << 511n)}`,
      `0x02${entry.slice(2)}${word(0n)}`,
    ])
      expect(() => decodeVaultMultiSend(data)).toThrow();
  });
});
