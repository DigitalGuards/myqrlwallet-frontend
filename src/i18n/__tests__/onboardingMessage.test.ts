import { readFileSync } from "node:fs";
import ts from "typescript";
import en from "@/locales/en/onboarding.json";
import { applyLanguage, i18n } from "../index";
import { onboardingError, onboardingMessage } from "../onboardingMessage";

// Read the producers so a new bridge error cannot silently escape this audit.
function credentialErrors(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const messages = new Set<string>();
  const visit = (node: ts.Node) => {
    // Explicit wallet removal has no caller in account creation/import/PIN setup.
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "clearDeviceCredential"
    )
      return;
    if (ts.isNewExpression(node)) {
      const message = node.arguments?.[0];
      if (
        /^(Error|DeviceCredentialUnavailableError)$/.test(
          node.expression.getText(source),
        ) &&
        message &&
        ts.isStringLiteral(message)
      )
        messages.add(message.text);
    }
    if (
      ts.isParameter(node) &&
      node.name.getText(source) === "message" &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      messages.add(node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(messages.size).toBeGreaterThan(0);
  return [...messages];
}

afterEach(() => applyLanguage("en"));

it.each(["en", "de", "es", "ru", "zh-CN"] as const)(
  "%s covers every native storage and device credential error at the form boundary",
  async (language) => {
    await applyLanguage(language);
    const t = i18n.getFixedT(null, [
      "onboarding",
      "common",
      "settings",
    ] as const);
    const messages = [
      ...credentialErrors("src/utils/nativeApp.ts"),
      ...credentialErrors("src/utils/crypto/deviceCredential.ts"),
      "Native secure storage failed.",
      "Invalid stored value",
      "Expected an array",
      "Expected a string",
      "Invalid token list",
      "Active account must be a valid QIP-55 address",
      "Account list contains an invalid QIP-55 account",
      "desktop: window.qrlWallet bridge is not available",
    ];
    for (const message of messages) {
      // The English catalog must contain the exact service contract text.
      const key = Object.entries(en).find(
        ([, value]) => value === message,
      )?.[0];
      expect(key).toBeDefined();
      const translated: unknown = i18n.getResource(
        language,
        "onboarding",
        key ?? "",
      );
      expect(typeof translated).toBe("string");
      expect(onboardingMessage(message, t)).toBe(translated);
      if (language === "en") expect(translated).toBe(message);
      else expect(translated).not.toBe(message);
      for (const [prefix, wrapper] of [
        ["Error: ", "onboarding:errorReason"],
        ["CryptoOperationError: ", "onboarding:cryptoErrorReason"],
        ["TypeError: ", "onboarding:typeErrorReason"],
      ] as const) {
        for (const failure of [
          "onboarding:createFailed",
          "onboarding:importFailed",
          "onboarding:setupFailed",
        ] as const) {
          const reason = prefix + message;
          const rendered = onboardingMessage(
            onboardingError({ key: failure, reason }),
            t,
          );
          expect(rendered).toBe(
            t(failure, { reason: t(wrapper, { reason: translated }) }),
          );
          if (language === "en") expect(rendered).toBe(t(failure, { reason }));
        }
      }
    }
  },
);

it.each(["en", "de", "es", "ru", "zh-CN"] as const)(
  "%s retains verbatim external details and unknown error types",
  async (language) => {
    await applyLanguage(language);
    const t = i18n.getFixedT(null, [
      "onboarding",
      "common",
      "settings",
    ] as const);
    for (const reason of [
      "RPC rejected request <code> & 0xAB12",
      "Error: external signer detail",
      "CryptoOperationError: browser crypto detail",
      "TypeError: external runtime detail",
      "DOMException: browser storage detail",
      "Native app detail: code 42",
      "i18n-onboarding:malformed external data",
    ]) {
      expect(onboardingMessage(reason, t)).toBe(reason);
      expect(
        onboardingMessage(
          onboardingError({ key: "onboarding:createFailed", reason }),
          t,
        ),
      ).toBe(t("onboarding:createFailed", { reason }));
    }
  },
);
