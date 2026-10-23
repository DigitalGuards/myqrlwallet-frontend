import {
  dappMessage,
  walletErrorMessages,
  walletErrorWrappers,
} from "../dappMessage";
import { applyLanguage, i18n } from "../index";

const languages = ["en", "de", "es", "ru", "zh-CN"] as const;
const translator = () =>
  i18n.getFixedT(null, ["dapps", "common", "settings", "transfer"] as const);
const diagnostic =
  "Invalid input: expected relay authorization token, received diagnostic-id-17";

afterEach(async () => {
  await applyLanguage("en");
});

describe.each(languages)("%s wallet error provenance", (language) => {
  beforeEach(async () => {
    await applyLanguage(language);
  });

  it.each(walletErrorMessages)(
    "translates exactly: $message",
    ({ message, key, values }) => {
      const result = dappMessage(message, translator());
      expect(result).toBe(translator()(key, values ?? {}));
      if (language === "en") expect(result).toBe(message);
      else expect(result).not.toBe(message);
      expect(result).not.toContain("{{");
    },
  );

  it.each(walletErrorMessages)(
    "preserves look-alikes of: $message",
    ({ message }) => {
      for (const external of [
        message + " external suffix",
        "External diagnostic: " + message,
        message.toUpperCase(),
        " \n" + message + "\t ",
      ]) {
        expect(dappMessage(external, translator())).toBe(external);
      }
    },
  );

  it.each(walletErrorWrappers)(
    "translates only one prefix: $prefix",
    ({ prefix, key, variable }) => {
      // Includes a second known wrapper, a known literal and interpolation-like data.
      const translatedPrefix = translator()(key, {
        reason: "",
        value: "",
        keys: "",
      });
      if (language === "en") expect(translatedPrefix).toBe(prefix);
      const template: unknown = i18n.getResource(
        language,
        "dapps",
        key.slice("dapps:".length),
      );
      if (typeof template !== "string")
        throw new Error("Missing wrapper translation");
      expect(template.endsWith(`{{${variable}}}`)).toBe(true);
      for (const remainder of [
        diagnostic,
        "Message signing failed: " + diagnostic,
        "Relay join acknowledgement timeout",
        "  <b>external</b> $t(dapps:approve) {{amount}} $&\nsecond line\t ",
      ]) {
        expect(dappMessage(prefix + remainder, translator())).toBe(
          translatedPrefix + remainder,
        );
      }
      for (const external of [
        prefix,
        prefix.toUpperCase() + diagnostic,
        "external " + prefix + diagnostic,
      ]) {
        expect(dappMessage(external, translator())).toBe(external);
      }
    },
  );

  it("preserves relay and pattern-shaped diagnostics verbatim", () => {
    for (const external of [
      diagnostic,
      "Invalid input: expected tuple, received undefined",
      'QRLDomain field "name" must be type "string", got "uint256"',
      'duplicate field "name" in Example',
      "uint256 out of range: 123",
      "the desktop signer used external, the payload requires external",
      "qrUri: URI exceeds 123 characters",
      "Incorrect PIN. 17 attempts remaining.",
      "Too many failed attempts. Please wait 99 minutes.",
      "constructor",
      "toString",
      "__proto__",
      "",
      "  \n\t ",
      "x".repeat(300000),
    ])
      expect(dappMessage(external, translator())).toBe(external);
  });

  it("handles the review's 12000-prefix attack with an intact remainder", () => {
    const prefix = "Message signing failed: ";
    const remainder = prefix.repeat(11999) + "external relay error";
    const external = prefix + remainder;
    const result = dappMessage(external, translator());
    const translatedPrefix = translator()("dapps:messageSigningFailed", {
      reason: "",
    });
    expect(result).toBe(translatedPrefix + remainder);
    expect(result.slice(translatedPrefix.length)).toBe(remainder);
    if (language === "en") expect(result).toBe(external);
  });
});

it("keeps the closed inventories unambiguous", () => {
  expect(new Set(walletErrorMessages.map(({ message }) => message)).size).toBe(
    walletErrorMessages.length,
  );
  expect(new Set(walletErrorWrappers.map(({ prefix }) => prefix)).size).toBe(
    walletErrorWrappers.length,
  );
  for (const { prefix } of walletErrorWrappers)
    expect(
      walletErrorWrappers.filter((other) => prefix.startsWith(other.prefix)),
    ).toHaveLength(1);
});
