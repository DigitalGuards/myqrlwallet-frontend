import { observer } from "mobx-react-lite";
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Send } from "lucide-react";
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
  isValidQrlAddress,
  getAddressValidationError,
} from "@/utils/web3";
import { WalletEncryptionUtil } from "@/utils/crypto";
import { getAddressFromMnemonicAsync } from "@/utils/crypto";
import { NftImage } from "./NftImage";
import { ROUTES } from "@/router/router";

const NftDetail = observer(() => {
  const navigate = useNavigate();
  const { contractAddress = "", tokenId = "" } = useParams();
  const { qrlStore, nftStore } = useStore();
  const { accountAddress } = qrlStore.activeAccount;
  const activeSource = qrlStore.activeAccountSource;
  const isExtension = activeSource === "extension";

  const nft = useMemo(
    () =>
      nftStore.nftList.find(
        (n) =>
          n.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
          n.tokenId === tokenId,
      ),
    [nftStore.nftList, contractAddress, tokenId],
  );

  const [toAddress, setToAddress] = useState("");
  const [toAddressError, setToAddressError] = useState("");
  const [amount, setAmount] = useState("1");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const txStatus = qrlStore.transactionStatus;

  useEffect(() => {
    // Reset on unmount
    return () => {
      qrlStore.resetTransactionStatus();
    };
  }, [qrlStore]);

  if (!nft) {
    return (
      <div className="mx-auto max-w-2xl px-2 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(ROUTES.HOME)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Card className="mt-4">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            NFT not found in your wallet. Add it from the Home page first.
          </CardContent>
        </Card>
      </div>
    );
  }

  const explorerUrl =
    QRL_PROVIDER[qrlStore.qrlConnection.blockchain as keyof typeof QRL_PROVIDER]
      ?.explorer ?? "https://zondscan.com";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendError(null);
    setPinError("");
    setToAddressError("");

    if (!isValidQrlAddress(toAddress)) {
      setToAddressError(getAddressValidationError(toAddress));
      return;
    }
    if (toAddress.toLowerCase() === accountAddress.toLowerCase()) {
      setToAddressError("Cannot send to your own address.");
      return;
    }

    let amountBig: bigint;
    try {
      amountBig = BigInt(amount);
    } catch {
      setSendError("Amount must be a whole number.");
      return;
    }
    if (nft.standard === "ERC721" && amountBig !== 1n) {
      setSendError("ERC-721 transfers are always 1 token.");
      return;
    }
    if (amountBig <= 0n) {
      setSendError("Amount must be positive.");
      return;
    }
    if (nft.balance && BigInt(nft.balance) < amountBig) {
      setSendError(`You only hold ${nft.balance} of this token.`);
      return;
    }

    setIsSending(true);
    try {
      if (isExtension) {
        // Extension-signed NFT writes aren't wired yet — surface a clear
        // message rather than silently using the encrypted-seed path.
        setSendError(
          "Extension-signed NFT transfers are coming soon. Switch to an imported account to transfer for now.",
        );
        setIsSending(false);
        return;
      }

      if (!pin || pin.length < 4) {
        setPinError("Enter your PIN to sign the transfer.");
        setIsSending(false);
        return;
      }

      const blockchain = await StorageUtil.getBlockChain();
      const encryptedSeed = await StorageUtil.getEncryptedSeed(
        blockchain,
        accountAddress,
      );
      if (!encryptedSeed) {
        setPinError(
          "No stored seed for this account. Re-import to set up a PIN.",
        );
        setIsSending(false);
        return;
      }
      let mnemonic: string;
      try {
        const decrypted = WalletEncryptionUtil.decryptSeedWithPin(
          encryptedSeed,
          pin,
        );
        mnemonic = decrypted.mnemonic;
      } catch {
        setPinError("Invalid PIN.");
        setIsSending(false);
        return;
      }
      const sender = await getAddressFromMnemonicAsync(
        mnemonic,
        qrlStore.qrlInstance!,
      );
      if (sender.toLowerCase() !== accountAddress.toLowerCase()) {
        setPinError("PIN decrypted an invalid seed. Re-import this account.");
        setIsSending(false);
        return;
      }

      const ok = await nftStore.transferNft(
        nft,
        toAddress,
        mnemonic,
        amountBig,
      );
      if (!ok) {
        setSendError(qrlStore.transactionStatus.error ?? "Transfer failed.");
      }
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Unexpected transfer error.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-2 py-4 md:py-8">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(ROUTES.HOME)}
        className="mb-4"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>

      <div className="grid gap-4 md:grid-cols-2 md:gap-8">
        <NftImage
          src={nft.image}
          alt={nft.name ?? `Token #${nft.tokenId}`}
          className="aspect-square w-full rounded-lg"
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              {nft.name ?? `Token #${nft.tokenId}`}
            </CardTitle>
            {nft.collectionName && (
              <p className="text-sm text-muted-foreground">
                {nft.collectionName}
                {nft.collectionSymbol ? ` (${nft.collectionSymbol})` : ""}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Standard" value={nft.standard} />
            <Row label="Token ID" value={nft.tokenId} mono />
            <Row
              label="Contract"
              value={
                <a
                  className="inline-flex items-center gap-1 text-blue-accent underline"
                  href={`${explorerUrl}/address/${nft.contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {nft.contractAddress.slice(0, 6)}…
                  {nft.contractAddress.slice(-4)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              }
            />
            {nft.standard === "ERC1155" && nft.balance && (
              <Row label="Balance" value={nft.balance} />
            )}
            {nft.description && (
              <>
                <Separator />
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    Description
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {nft.description}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 border-l-4 border-l-blue-accent">
        <CardHeader>
          <CardTitle className="text-lg">Transfer</CardTitle>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            {sendError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
              >
                {sendError}
              </div>
            )}
            {txStatus.state === "confirmed" && txStatus.txHash && (
              <div
                role="status"
                className="rounded-md bg-green-500/15 p-3 text-sm text-green-400"
              >
                Transfer confirmed.{" "}
                <a
                  className="underline"
                  href={`${explorerUrl}/tx/${txStatus.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on explorer
                </a>
              </div>
            )}
            {txStatus.state === "pending" && (
              <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Broadcasting transaction…
              </div>
            )}

            <div>
              <Label htmlFor="nft-to">Recipient Address</Label>
              <Input
                id="nft-to"
                value={toAddress}
                onChange={(e) => {
                  setToAddress(e.target.value.trim());
                  setToAddressError("");
                }}
                placeholder="Q…"
                disabled={isSending}
              />
              {toAddressError && (
                <p className="mt-1 text-xs text-destructive">
                  {toAddressError}
                </p>
              )}
            </div>

            {nft.standard === "ERC1155" && (
              <div>
                <Label htmlFor="nft-amount">Amount</Label>
                <Input
                  id="nft-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.trim())}
                  inputMode="numeric"
                  disabled={isSending}
                />
                {nft.balance && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Holding: {nft.balance}
                  </p>
                )}
              </div>
            )}

            {!isExtension && (
              <div>
                <Label>Wallet PIN</Label>
                <PinInput
                  value={pin}
                  onChange={setPin}
                  placeholder="Enter PIN"
                  error={pinError || undefined}
                  disabled={isSending}
                />
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={isSending || !accountAddress}
            >
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Transfer
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
});

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-sm" : "text-sm"}>{value}</div>
    </div>
  );
}

export default NftDetail;
