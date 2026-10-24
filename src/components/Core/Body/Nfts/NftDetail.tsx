import { Trans, useTranslation } from "react-i18next";
import {
  assetMessage,
  assetPinError,
  assetServiceError,
  nftTransferFailure,
  type AssetMessage,
} from "@/i18n/assetMessage";
import { nftValue, type NFTInterface } from "@/constants/nft";
import { arrayValue, stringValue } from "@/utils/guards";
import { renderValue, toBigInt, toTemplateString } from "@/utils/guards";
import { reportError } from "@/utils/reportError";
import {
  PinVerificationError,
  verifyPinWithLimit,
} from "@/utils/crypto/verifyPinWithLimit";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { observer } from "mobx-react-lite";
import { useLocation, useNavigate, useParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { Button } from "@/components/UI/Button";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { Separator } from "@/components/UI/Separator";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { useStore } from "@/stores/store";
import { StorageUtil } from "@/utils/storage";
import { QRL_PROVIDER } from "@/config";
import {
  DeviceCredentialUnavailableError,
  decryptStoredSeedWithPin,
  getAddressFromMnemonicAsync,
} from "@/utils/crypto";
import { walletMutations } from "@/utils/nativeWalletMutation";
import { isDesktop } from "@/desktop/bridge";
import { NftImage } from "./NftImage";
import { ROUTES } from "@/router/router";
import { nftCollectionPath, openedFromCollectionView } from "./nftNavigation";
import { useNetworkQrnsRecipient } from "@/hooks/useNetworkQrnsRecipient";
import { RecipientResolutionStatus } from "@/components/Core/RecipientResolutionStatus";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { cn } from "@/utils/cn";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";

const NftDetail = observer(() => {
  const { t } = useTranslation([
    "creation",
    "nfts",
    "tokens",
    "home",
    "transfer",
    "settings",
    "onboarding",
    "common",
  ]);
  const navigate = useNavigate();
  const location = useLocation();
  const { contractAddress = "", tokenId = "" } = useParams();
  const { qrlStore, nftStore } = useStore();
  const { accountAddress } = qrlStore.activeAccount;
  const activeSource = qrlStore.activeAccountSource;
  const isExtension = activeSource === "extension";

  const nft = useMemo(
    () =>
      arrayValue(nftStore.nftList).find(
        (n): n is NFTInterface & { contractAddress: string } =>
          stringValue(nftValue(n).contractAddress).toLowerCase() ===
            contractAddress.toLowerCase() && nftValue(n).tokenId === tokenId,
      ),
    [nftStore.nftList, contractAddress, tokenId],
  );

  // The wallet still lists this contract, so the gallery can open its
  // collection view. A token the wallet never held (or one just sent
  // away) has no collection to return to, which leaves the home page.
  const walletHoldsCollection = useMemo(
    () =>
      arrayValue(nftStore.nftList).some(
        (n) =>
          stringValue(nftValue(n).contractAddress).toLowerCase() ===
          contractAddress.toLowerCase(),
      ),
    [nftStore.nftList, contractAddress],
  );

  // Back pops the pushed entry when this page was opened from its
  // collection view, so the in-app Back button matches the browser Back
  // button. A deep link has nothing to pop, so it navigates to the
  // collection view (replacing this entry, which leaves no dead end).
  const onBack = () => {
    if (openedFromCollectionView(location.state)) {
      Promise.resolve(navigate(-1)).catch((error: unknown) => {
        reportError("Failed to navigate back:", error);
      });
      return;
    }
    Promise.resolve(
      navigate(
        walletHoldsCollection
          ? nftCollectionPath(ROUTES.HOME, contractAddress)
          : ROUTES.HOME,
        { replace: true },
      ),
    ).catch((error: unknown) => {
      reportError("Failed to open NFT collection:", error);
    });
  };

  const [toAddress, setToAddress] = useState("");
  const [toAddressError, setToAddressError] = useState<AssetMessage | null>(
    null,
  );
  const [amount, setAmount] = useState("1");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<AssetMessage | null>(null);
  const [sendError, setSendError] = useState<AssetMessage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const blockchain = qrlStore.qrlConnection.blockchain;
  const recipientResolution = useNetworkQrnsRecipient({
    input: toAddress,
    blockchain,
    accountAddress,
  });

  const txStatus = qrlStore.transactionStatus;

  useEffect(() => {
    // Reset on unmount
    return () => {
      qrlStore.resetTransactionStatus();
    };
  }, [qrlStore]);

  if (!nft) {
    return (
      <PageShell
        title={t("nfts:details")}
        width="wide"
        seoTitle={t("nfts:detailsSeo")}
        action={
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("nfts:back")}
          </Button>
        }
      >
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("nfts:missing")}
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const explorerUrl =
    Object.entries(QRL_PROVIDER).find(([id]) => id === blockchain)?.[1]
      .explorer ?? "https://zondscan.com";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendError(null);
    setPinError(null);
    setToAddressError(null);

    const recipientSubmission =
      recipientResolution.captureSubmission(toAddress);
    if (!recipientSubmission) {
      setToAddressError(
        recipientResolution.message
          ? { recipient: recipientResolution.message }
          : { key: "transfer:validRecipient" },
      );
      return;
    }
    if (
      recipientSubmission.address.toLowerCase() === accountAddress.toLowerCase()
    ) {
      setToAddressError({ key: "nfts:selfSend" });
      return;
    }

    let amountBig: bigint;
    try {
      amountBig = BigInt(amount);
    } catch {
      setSendError({ key: "nfts:wholeAmount" });
      return;
    }
    if (nft.standard === "ERC721" && amountBig !== 1n) {
      setSendError({ key: "nfts:amount721" });
      return;
    }
    if (amountBig <= 0n) {
      setSendError({ key: "nfts:positiveAmount" });
      return;
    }
    if (nft.balance && toBigInt(nft.balance) < amountBig) {
      setSendError({
        key: "nfts:insufficient",
        balance: toTemplateString(nft.balance),
      });
      return;
    }

    setIsSending(true);
    try {
      if (isExtension) {
        // Extension-signed NFT writes aren't wired yet : surface a clear
        // message rather than silently using the encrypted-seed path.
        setSendError({ key: "nfts:extensionUnsupported" });
        setIsSending(false);
        return;
      }

      if (isDesktop) {
        // Desktop: no PIN, no seed in the renderer. The store builds the
        // safeTransferFrom calldata and routes through the signer; the
        // mnemonic arg is unused.
        const recipientAddress =
          recipientResolution.revalidateSubmission(recipientSubmission);
        if (!recipientAddress) {
          setToAddressError({ key: "transfer:recipientChanged" });
          setIsSending(false);
          return;
        }
        const ok = await nftStore.transferNft(
          nft,
          recipientAddress,
          "",
          amountBig,
          // The NFT detail screen shows no network fee yet, so there is no
          // displayed figure to hold the signature to. Said explicitly, so it
          // reads as a gap to close rather than a forgotten argument.
          "medium",
          FEE_NOT_SHOWN,
        );
        if (!ok) {
          setSendError(nftTransferFailure(qrlStore.transactionStatus.error));
        }
        setIsSending(false);
        return;
      }

      if (!pin || pin.length < 4) {
        setPinError({ key: "nfts:pinRequired" });
        setIsSending(false);
        return;
      }

      const signingGeneration = walletMutations.captureGeneration();
      const blockchain = await StorageUtil.getBlockChain();
      const encryptedSeed = await StorageUtil.getEncryptedSeed(
        blockchain,
        accountAddress,
      );
      if (!encryptedSeed) {
        setPinError({ key: "nfts:noSeed" });
        setIsSending(false);
        return;
      }
      let mnemonic: string;
      try {
        const decrypted = await verifyPinWithLimit(() =>
          decryptStoredSeedWithPin(
            blockchain,
            accountAddress,
            encryptedSeed,
            pin,
            signingGeneration,
          ),
        );
        mnemonic = decrypted.mnemonic;
      } catch (error) {
        setPinError(
          error instanceof PinVerificationError
            ? assetPinError(error)
            : error instanceof DeviceCredentialUnavailableError
              ? { key: "creation:credentialUnavailable" }
              : { key: "transfer:unlockFailed" },
        );
        setIsSending(false);
        return;
      }
      const qrlInstance = qrlStore.qrlInstance;
      if (!qrlInstance) {
        setPinError({ key: "transfer:notConnected" });
        setIsSending(false);
        return;
      }
      const sender = await getAddressFromMnemonicAsync(mnemonic, qrlInstance);
      if (sender !== accountAddress) {
        setPinError({ key: "nfts:wrongWallet" });
        setIsSending(false);
        return;
      }

      if (!walletMutations.isCurrent(signingGeneration)) {
        throw new Error("Wallet changed while preparing the NFT transfer");
      }

      const recipientAddress =
        recipientResolution.revalidateSubmission(recipientSubmission);
      if (!recipientAddress) {
        setToAddressError({ key: "transfer:recipientChanged" });
        setIsSending(false);
        return;
      }
      const ok = await nftStore.transferNft(
        nft,
        recipientAddress,
        mnemonic,
        amountBig,
        // No network fee is displayed for an NFT transfer yet.
        "medium",
        FEE_NOT_SHOWN,
      );
      if (!ok) {
        setSendError(nftTransferFailure(qrlStore.transactionStatus.error));
      }
    } catch (err) {
      setSendError(
        err instanceof Error
          ? assetServiceError(err.message)
          : { key: "transfer:unexpectedError" },
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <PageShell
      title={renderValue(
        nft.name ?? t("home:nftToken", { id: toTemplateString(nft.tokenId) }),
      )}
      subtitle={
        nft.collectionName
          ? `${toTemplateString(nft.collectionName)}${nft.collectionSymbol ? ` (${toTemplateString(nft.collectionSymbol)})` : ""}`
          : undefined
      }
      width="wide"
      seoTitle={
        nft.name ?? t("home:nftToken", { id: toTemplateString(nft.tokenId) })
      }
      action={
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("nfts:back")}
        </Button>
      }
    >
      <Card className="p-6">
        <div className="grid gap-4 md:grid-cols-2 md:gap-8">
          <NftImage
            src={nft.image}
            alt={
              nft.name ??
              t("home:nftToken", { id: toTemplateString(nft.tokenId) })
            }
            className="aspect-square w-full rounded-lg"
          />
          <div className="min-w-0">
            <div className="space-y-3 text-sm">
              <Row
                label={t("nfts:standard")}
                value={renderValue(nft.standard)}
              />
              <Row
                label={t("nfts:tokenId")}
                value={renderValue(nft.tokenId)}
                mono
              />
              <Row
                label={t("nfts:contract")}
                value={
                  <QrlAddress
                    address={nft.contractAddress}
                    href={`${explorerUrl}/address/${nft.contractAddress}`}
                    linkLabel={t("nfts:viewContract")}
                    copyable
                    copyLabel={t("nfts:copyContract")}
                    className="justify-end"
                    addressClassName="whitespace-normal [overflow-wrap:anywhere]"
                  />
                }
              />
              {renderValue(
                nft.standard === "ERC1155" && nft.balance && (
                  <Row
                    label={t("tokens:balance")}
                    value={renderValue(nft.balance)}
                    numeric
                  />
                ),
              )}
              {renderValue(
                nft.description && (
                  <>
                    <Separator />
                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {t("nfts:description")}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                        {renderValue(nft.description)}
                      </p>
                    </div>
                  </>
                ),
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">{t("home:transfer")}</CardTitle>
        </CardHeader>
        <form
          onSubmit={(event) => {
            onSubmit(event).catch((error: unknown) => {
              setSendError(
                error instanceof Error
                  ? assetServiceError(error.message)
                  : { key: "transfer:unexpectedError" },
              );
            });
          }}
        >
          <CardContent className="space-y-4">
            {assetMessage(sendError, t) && (
              <div
                role="alert"
                className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
              >
                {assetMessage(sendError, t)}
              </div>
            )}
            {txStatus.state === "confirmed" && txStatus.txHash && (
              <div
                role="status"
                className="rounded-md bg-success/15 p-3 text-sm text-success"
              >
                {t("nfts:confirmed")}{" "}
                <a
                  className="underline"
                  href={`${explorerUrl}/tx/${txStatus.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("nfts:viewExplorer")}
                </a>
              </div>
            )}
            {txStatus.state === "pending" && (
              <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("nfts:broadcasting")}
              </div>
            )}

            <div>
              <Label htmlFor="nft-to">{t("nfts:recipient")}</Label>
              <Input
                id="nft-to"
                value={toAddress}
                onChange={(e) => {
                  setToAddress(e.target.value);
                  setToAddressError(null);
                }}
                placeholder={t("transfer:recipientPlaceholder")}
                disabled={isSending}
              />
              <RecipientResolutionStatus resolution={recipientResolution} />
              {assetMessage(toAddressError, t) && (
                <p className="mt-1 text-xs text-destructive">
                  {assetMessage(toAddressError, t)}
                </p>
              )}
            </div>

            {nft.standard === "ERC1155" && (
              <div>
                <Label htmlFor="nft-amount">{t("transfer:amount")}</Label>
                <Input
                  id="nft-amount"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value.trim());
                  }}
                  inputMode="numeric"
                  disabled={isSending}
                />
                {renderValue(
                  nft.balance && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <Trans
                        t={t}
                        i18nKey="nfts:holding"
                        components={{
                          balance: <>{renderValue(nft.balance)}</>,
                        }}
                      />
                    </p>
                  ),
                )}
              </div>
            )}

            {/* PIN entry is web/native only. On desktop the signer session
                authorizes the transfer (no PIN). */}
            {!isExtension && !isDesktop && (
              <div>
                <Label>{t("settings:walletPin")}</Label>
                <PinInput
                  value={pin}
                  onChange={setPin}
                  placeholder={t("nfts:pinPlaceholder")}
                  error={assetMessage(pinError, t)}
                  disabled={isSending}
                />
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={
                isSending || !accountAddress || !recipientResolution.address
              }
            >
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("nfts:sending")}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {t("home:transfer")}
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </PageShell>
  );
});

function Row({
  label,
  value,
  mono,
  numeric,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  numeric?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="shrink-0 text-xs uppercase text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "min-w-0 max-w-full grow text-right [overflow-wrap:anywhere]",
          mono ? "font-mono text-sm" : "text-sm",
          numeric && "font-numeric",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export default NftDetail;
