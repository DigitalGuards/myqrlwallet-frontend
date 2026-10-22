import type { TFunction } from "i18next";
import { z } from "zod";

export type OnboardingTranslator = TFunction<
  ["onboarding", "common", "settings"]
>;
const errorSchema = z.object({
  key: z.enum([
    "onboarding:createFailed",
    "onboarding:importFailed",
    "onboarding:setupFailed",
  ]),
  reason: z.string(),
});
const prefix = "i18n-onboarding:";

/** Keep form messages stable until rendering, including external error details. */
export function onboardingError(value: z.infer<typeof errorSchema>): string {
  return prefix + JSON.stringify(value);
}

/** Translate owned copy at the presentation boundary; shared service contracts stay intact. */
export function onboardingMessage(
  message: string | undefined,
  t: OnboardingTranslator,
): string | undefined {
  if (message === undefined) return undefined;
  if (message.startsWith(prefix)) {
    try {
      const value: unknown = JSON.parse(message.slice(prefix.length));
      const parsed = errorSchema.safeParse(value);
      if (parsed.success)
        return t(parsed.data.key, {
          reason: onboardingMessage(parsed.data.reason, t),
        });
    } catch {
      /* Preserve unknown service data. */
    }
  }
  switch (message) {
    case "The native device credential is invalid.":
      return t("onboarding:nativeCredentialInvalid");
    case "This wallet cannot be opened because its device security credential is unavailable.":
      return t("onboarding:deviceCredentialMissing");
    case "Secure browser storage is unavailable. Wallet creation has been stopped.":
      return t("onboarding:secureStorageUnavailable");
    case "Secure browser storage could not be opened. Wallet creation has been stopped.":
      return t("onboarding:secureStorageOpenFailed");
    case "Secure browser storage is blocked by another wallet tab.":
      return t("onboarding:secureStorageBlocked");
    case "The secure browser credential is corrupt or has an unsupported format.":
      return t("onboarding:browserCredentialCorrupt");
    case "The secure browser credential could not be read.":
      return t("onboarding:browserCredentialReadFailed");
    case "The secure browser credential was not durably stored.":
      return t("onboarding:browserCredentialNotStored");
    case "The secure browser credential could not be durably stored.":
      return t("onboarding:browserCredentialStoreFailed");
    case "The secure browser credential write was interrupted.":
      return t("onboarding:browserCredentialInterrupted");
    case "Another wallet tab created a device credential, but it could not be loaded.":
      return t("onboarding:browserCredentialRace");
    case "Native secure storage failed.":
      return t("onboarding:nativeStorageFailed");
    case "The native app did not confirm secure wallet storage. Update the app and try again.":
      return t("onboarding:nativeStorageUnconfirmed");
    case "Native secure seed backup failed.":
      return t("onboarding:nativeSeedBackupFailed");
    case "Native acknowledged a different seed backup revision.":
      return t("onboarding:nativeSeedBackupMismatch");
    case "Native secure seed backup is unavailable.":
      return t("onboarding:nativeSeedBackupUnavailable");
    case "A valid encrypted-seed revision is required.":
      return t("onboarding:nativeSeedRevisionInvalid");
    case "The native app did not confirm the secure seed backup.":
      return t("onboarding:nativeSeedBackupUnconfirmed");
    case "The native wallet bridge is unavailable.":
      return t("onboarding:nativeBridgeUnavailable");
    case "Native secure storage could not provide the wallet credential.":
      return t("onboarding:nativeCredentialFailed");
    case "Native returned an invalid wallet credential response.":
      return t("onboarding:nativeCredentialResponseInvalid");
    case "Native secure storage is unavailable.":
      return t("onboarding:nativeStorageUnavailable");
    case "A valid device credential candidate is required.":
      return t("onboarding:nativeCredentialCandidateInvalid");
    case "Invalid stored value":
      return t("onboarding:storedValueInvalid");
    case "Expected an array":
      return t("onboarding:storedArrayExpected");
    case "Expected a string":
      return t("onboarding:storedStringExpected");
    case "Invalid token list":
      return t("onboarding:storedTokenListInvalid");
    case "Active account must be a valid QIP-55 address":
      return t("onboarding:activeAccountInvalid");
    case "Account list contains an invalid QIP-55 account":
      return t("onboarding:accountListInvalid");
    case "desktop: window.qrlWallet bridge is not available":
      return t("onboarding:desktopBridgeUnavailable");
    case "Invalid PIN format":
      return t("onboarding:pinFormatInvalid");
    case "Unknown crypto error":
      return t("onboarding:cryptoUnknown");
    case "Invalid crypto worker response":
      return t("onboarding:workerResponseInvalid");
    case "Worker error":
      return t("onboarding:workerFailed");
    case "Wallet identity changed before sensitive storage write":
      return t("onboarding:identityBeforeWrite");
    case "Wallet identity changed during sensitive storage write":
      return t("onboarding:identityDuringWrite");

    case "Password must be at least 8 characters":
    case "onboarding:passwordMin":
      return t("onboarding:passwordMin");
    case "Password must contain at least one uppercase letter":
    case "onboarding:passwordUpper":
      return t("onboarding:passwordUpper");
    case "Password must contain at least one lowercase letter":
    case "onboarding:passwordLower":
      return t("onboarding:passwordLower");
    case "Password must contain at least one number":
    case "onboarding:passwordNumber":
      return t("onboarding:passwordNumber");
    case 'Password must contain at least one special character (!@#$%^&*(),.?":{}|<>)':
    case "onboarding:passwordSpecial":
      return t("onboarding:passwordSpecial");
    case "PIN must be at least 4 digits":
    case "onboarding:pinMin":
      return t("onboarding:pinMin");
    case "PIN must be at most 6 digits":
    case "onboarding:pinMax":
      return t("onboarding:pinMax");
    case "PIN must contain only digits":
    case "onboarding:pinDigits":
      return t("onboarding:pinDigits");
    case "Please re-enter your password":
    case "onboarding:passwordRepeatRequired":
      return t("onboarding:passwordRepeatRequired");
    case "Passwords don't match":
    case "onboarding:passwordMismatch":
      return t("onboarding:passwordMismatch");
    case "PINs don't match":
    case "onboarding:pinMismatch":
      return t("onboarding:pinMismatch");
    case "This wallet was saved in an older format and must be re-imported.":
    case "onboarding:olderFormat":
      return t("onboarding:olderFormat");
    case "The device security credential is unavailable. Review the recovery steps below.":
    case "onboarding:credentialUnavailable":
      return t("onboarding:credentialUnavailable");
    case "Failed to unlock the seed. Please try again.":
    case "onboarding:unlockFailed":
      return t("onboarding:unlockFailed");
    case "Mnemonic phrases are required":
    case "onboarding:mnemonicRequired":
      return t("onboarding:mnemonicRequired");
    case "Invalid mnemonic phrases":
    case "onboarding:mnemonicInvalid":
      return t("onboarding:mnemonicInvalid");
    case "Hex seed is required":
    case "onboarding:hexRequired":
      return t("onboarding:hexRequired");
    case "Invalid hex seed format. Must start with '0x' followed by hex characters":
    case "onboarding:hexFormat":
      return t("onboarding:hexFormat");
    case "Failed to derive mnemonic from hex seed":
    case "onboarding:hexMnemonicFailed":
      return t("onboarding:hexMnemonicFailed");
    case "Invalid hex seed":
    case "onboarding:hexInvalid":
      return t("onboarding:hexInvalid");
    case "Password is required":
    case "onboarding:passwordRequired":
      return t("onboarding:passwordRequired");
    case "Password is too long":
    case "onboarding:passwordLong":
      return t("onboarding:passwordLong");
    case "Wallet file is too large":
    case "onboarding:fileLarge":
      return t("onboarding:fileLarge");
    case "Please select a valid JSON wallet file":
    case "onboarding:fileJson":
      return t("onboarding:fileJson");
    case "Invalid wallet file format":
    case "onboarding:fileInvalid":
      return t("onboarding:fileInvalid");
    case "Please select a wallet file":
    case "onboarding:fileRequired":
      return t("onboarding:fileRequired");
    case "The backup file contains no keystores.":
    case "onboarding:noKeystores":
      return t("onboarding:noKeystores");
    case "Could not decrypt the wallet file. Check the password and try again. For extension backups this is the extension's unlock password.":
    case "onboarding:keystoreDecryptFailed":
      return t("onboarding:keystoreDecryptFailed");
    case "Failed to decrypt wallet. Please check your password.":
    case "onboarding:fileDecryptFailed":
      return t("onboarding:fileDecryptFailed");
    case "Failed to create account":
    case "onboarding:createAccountFailed":
      return t("onboarding:createAccountFailed");
    case "Failed to generate mnemonic":
    case "onboarding:generateMnemonicFailed":
      return t("onboarding:generateMnemonicFailed");
    case "Wallet was cleared during account creation":
    case "onboarding:clearedCreation":
      return t("onboarding:clearedCreation");
    case "Wallet was cleared during account import":
    case "onboarding:clearedImport":
      return t("onboarding:clearedImport");
    case "Wallet clear is in progress":
    case "onboarding:clearInProgress":
      return t("onboarding:clearInProgress");
    case "Invalid keystore backup file.":
    case "onboarding:keystoreInvalid":
      return t("onboarding:keystoreInvalid");
    case "Unsupported derived-key length (only dklen 32 / AES-256 is supported).":
    case "onboarding:keystoreKeyLength":
      return t("onboarding:keystoreKeyLength");
    case "Another PIN check is still running. Please try again.":
      return t("settings:pinBusy");
  }
  const attempts = /^Incorrect PIN\. (\d+) attempts? remaining\.$/.exec(
    message,
  );
  if (attempts)
    return t("settings:incorrectPin", { count: Number(attempts[1]) });
  const lockout =
    /^Too many failed attempts\. Please wait (\d+) minutes?\.$/.exec(message);
  if (lockout) return t("settings:lockout", { count: Number(lockout[1]) });
  if (message.startsWith("CryptoOperationError: ")) {
    const reason = message.slice("CryptoOperationError: ".length);
    const translated = onboardingMessage(reason, t);
    if (translated !== reason)
      return t("onboarding:cryptoErrorReason", { reason: translated });
  }
  if (message.startsWith("Error: ")) {
    const reason = message.slice(7);
    const translated = onboardingMessage(reason, t);
    if (translated !== reason)
      return t("onboarding:errorReason", { reason: translated });
  }
  if (message.startsWith("TypeError: ")) {
    const reason = message.slice("TypeError: ".length);
    const translated = onboardingMessage(reason, t);
    if (translated !== reason)
      return t("onboarding:typeErrorReason", { reason: translated });
  }
  const keystoreHex = /^Invalid hex in keystore ([\s\S]+)\.$/.exec(message);
  if (keystoreHex)
    return t("onboarding:keystoreHex", { field: keystoreHex[1] });
  const keystoreObject = /^Invalid keystore #(\d+): not an object\.$/.exec(
    message,
  );
  if (keystoreObject)
    return t("onboarding:keystoreObject", { number: keystoreObject[1] });
  const keystoreVersion =
    /^Unsupported keystore #(\d+) version \(expected 1\)\.$/.exec(message);
  if (keystoreVersion)
    return t("onboarding:keystoreVersion", { number: keystoreVersion[1] });
  const keystoreCrypto =
    /^Invalid keystore #(\d+): missing crypto section\.$/.exec(message);
  if (keystoreCrypto)
    return t("onboarding:keystoreCrypto", { number: keystoreCrypto[1] });
  const keystoreCipher =
    /^Unsupported cipher in keystore #(\d+) \(expected aes-256-gcm\)\.$/.exec(
      message,
    );
  if (keystoreCipher)
    return t("onboarding:keystoreCipher", { number: keystoreCipher[1] });
  const keystoreKdf =
    /^Unsupported KDF in keystore #(\d+) \(expected argon2id\)\.$/.exec(
      message,
    );
  if (keystoreKdf)
    return t("onboarding:keystoreKdf", { number: keystoreKdf[1] });
  const keystoreCipherparams =
    /^Invalid keystore #(\d+): missing cipherparams\.$/.exec(message);
  if (keystoreCipherparams)
    return t("onboarding:keystoreCipherparams", {
      number: keystoreCipherparams[1],
    });
  const keystoreIv =
    /^Invalid IV in keystore #(\d+) \(expected 12 bytes of hex\)\.$/.exec(
      message,
    );
  if (keystoreIv) return t("onboarding:keystoreIv", { number: keystoreIv[1] });
  const keystoreCiphertext = /^Invalid ciphertext in keystore #(\d+)\.$/.exec(
    message,
  );
  if (keystoreCiphertext)
    return t("onboarding:keystoreCiphertext", {
      number: keystoreCiphertext[1],
    });
  const keystoreKdfparams =
    /^Invalid keystore #(\d+): missing kdfparams\.$/.exec(message);
  if (keystoreKdfparams)
    return t("onboarding:keystoreKdfparams", { number: keystoreKdfparams[1] });
  const keystoreBounds =
    /^KDF parameters in keystore #(\d+) are outside the accepted bounds\.$/.exec(
      message,
    );
  if (keystoreBounds)
    return t("onboarding:keystoreBounds", { number: keystoreBounds[1] });
  const keystoreSalt = /^Invalid salt in keystore #(\d+)\.$/.exec(message);
  if (keystoreSalt)
    return t("onboarding:keystoreSalt", { number: keystoreSalt[1] });
  const keystoreMetadata = /^Invalid metadata in keystore #(\d+)\.$/.exec(
    message,
  );
  if (keystoreMetadata)
    return t("onboarding:keystoreMetadata", { number: keystoreMetadata[1] });
  const keystoreLimit =
    /^The backup file contains more than (\d+) keystores\.$/.exec(message);
  if (keystoreLimit)
    return t("onboarding:keystoreLimit", { limit: keystoreLimit[1] });
  const keystoreSeedLength =
    /^Decrypted seed has an unsupported length \((\d+) bytes; expected (\d+)\)\.$/.exec(
      message,
    );
  if (keystoreSeedLength)
    return t("onboarding:keystoreSeedLength", {
      length: keystoreSeedLength[1],
      expected: keystoreSeedLength[2],
    });
  return message;
}
