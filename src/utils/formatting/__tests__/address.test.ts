import {
  formatAddress,
  formatAddressEnds,
  formatAddressFingerprint,
  formatAddressFingerprintsInText,
} from "../address";

const Q128 =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";

describe("QRL address presentation", () => {
  it("keeps only the first and last eight payload characters in short labels", () => {
    expect(formatAddressEnds(Q128)).toBe("Qd5812F6C...8A9A8B72");
    expect(formatAddressEnds("Z0123456789abcdefFEDCBA9876543210aBcDeF12")).toBe(
      "Z01234567...aBcDeF12",
    );
  });
  it("samples the first, middle, and final eight payload characters of Q128", () => {
    expect(formatAddressFingerprint(Q128)).toBe(
      "Qd5812F6C...e547985f...8A9A8B72",
    );
  });

  it("preserves the prefix and checksum casing for legacy Z40 addresses", () => {
    const address = "Z0123456789abcdefFEDCBA9876543210aBcDeF12";

    expect(formatAddressFingerprint(address)).toBe(
      "Z01234567...FEDCBA98...aBcDeF12",
    );
  });

  it("preserves legitimate legacy Q40 address fingerprints", () => {
    const address = `Q${"11111111"}${"2".repeat(8)}${"33333333"}${"4".repeat(8)}${"55555555"}`;

    expect(formatAddressFingerprint(address)).toBe(
      "Q11111111...33333333...55555555",
    );
  });

  it.each([
    "",
    "Q1234AbCd",
    "this-is-an-arbitrary-value-that-is-longer-than-24-characters",
    `Q${"1".repeat(127)}`,
    `Q${"1".repeat(129)}`,
    `Q${"g".repeat(128)}`,
    `q${"1".repeat(128)}`,
    `Z${"1".repeat(128)}`,
    `QD${Q128.slice(2)}`,
  ])("returns unsupported values unchanged", (address) => {
    expect(formatAddressFingerprint(address)).toBe(address);
    expect(formatAddressEnds(address)).toBe(address);
    expect(formatAddress(address)).toBe(address);
  });

  it("groups the complete Q128 payload into eight-character wrap points", () => {
    const grouped = formatAddress(Q128);

    expect(grouped.replace(/ /g, "")).toBe(Q128);
    expect(grouped.split(" ")).toHaveLength(16);
    expect(grouped.startsWith("Qd5812F6C f4a0f645")).toBe(true);
  });

  it("compacts an address embedded in a wallet filename", () => {
    expect(
      formatAddressFingerprintsInText(`encrypted-wallet-${Q128}.json`),
    ).toBe("encrypted-wallet-Qd5812F6C...e547985f...8A9A8B72.json");
  });

  it("leaves arbitrary and invalid filename text unchanged", () => {
    const filename = `encrypted-wallet-Q${"g".repeat(128)}.json`;

    expect(formatAddressFingerprintsInText(filename)).toBe(filename);
  });
});
