import { applyLanguage, i18n } from "../index";
import { dappMessage } from "../dappMessage";
import { parseConnectionURI } from "@/services/dappConnect/qrUri";

const translator = () =>
  i18n.getFixedT(null, ["dapps", "common", "settings", "transfer"] as const);
afterEach(async () => {
  await applyLanguage("en");
});

it("translates actual pairing parser failures and preserves their English bytes", async () => {
  const messages: string[] = [];
  for (const uri of [
    "",
    "wrong",
    " qrlconnect://?q=x",
    "qrlconnect://?channelId=x",
    "qrlconnect://?unknown=x",
    "qrlconnect://?q=x&q=y",
    "qrlconnect://?r=x&r=y",
    "qrlconnect://",
    "qrlconnect://?q=1",
    "qrlconnect://?q=!!",
    `qrlconnect://?q=${"a".repeat(4096)}`,
  ]) {
    try {
      await parseConnectionURI(uri);
      throw new Error("Fixture unexpectedly accepted");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      messages.push(error.message);
    }
  }
  for (const language of ["en", "de", "es", "ru", "zh-CN"] as const) {
    await applyLanguage(language);
    for (const message of messages) {
      const result = dappMessage(message, translator());
      if (language === "en") expect(result).toBe(message);
      else expect(result).not.toBe(message);
      expect(result).not.toContain("{{");
    }
  }
});
it.each(["en", "de", "es", "ru", "zh-CN"] as const)(
  "preserves external pairing details in %s",
  async (language) => {
    await applyLanguage(language);
    const reason =
      "External relay diagnostic: https://dapp.example Q123 0xabcd 123.4500";
    expect(dappMessage(reason, translator())).toBe(reason);
    expect(
      dappMessage(`qrUri: base45 decode failed: ${reason}`, translator()),
    ).toContain(reason);
  },
);
