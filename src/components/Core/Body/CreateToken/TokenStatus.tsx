import { PageShell } from "@/components/Core/Layout/PageShell";
import { observer } from "mobx-react-lite";
import { useStore } from "@/stores/store";
import { useEffect } from "react";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
import { Check, Copy, ExternalLink, Loader2, XCircle } from "lucide-react";
import { StringUtil } from "@/utils/formatting";
import { utils } from "@theqrl/web3";
import { BigNumber } from "bignumber.js";
import { Button } from "@/components/UI/Button";
import { ROUTES } from "@/router/router";
import { Link } from "react-router";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { QRL_PROVIDER } from "@/config";

const TokenStatus = observer(() => {
  const { qrlStore, tokenStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { addToken, createdToken, creatingToken } = tokenStore;
  const {
    name,
    symbol,
    decimals,
    address,
    tx,
    blockNumber,
    blockHash,
    gasUsed,
    effectiveGasPrice,
  } = createdToken;
  const explorerUrl =
    Object.entries(QRL_PROVIDER).find(
      ([id]) => id === qrlConnection.blockchain,
    )?.[1].explorer || "https://zondscan.com";

  const { copiedItem, copyToClipboard } = useCopyToClipboard<
    "txHash" | "tokenAddress" | "blockHash"
  >();

  const gasInQrl = new BigNumber(
    utils.fromPlanck(
      BigInt(gasUsed) * BigInt(effectiveGasPrice ?? 0),
      "quanta",
    ),
  )
    .dp(8, BigNumber.ROUND_DOWN)
    .toString()
    .replace(/\.?0+$/, "");

  useEffect(() => {
    const addCreatedToken = async () => {
      if (address) {
        try {
          await addToken({
            name,
            symbol,
            decimals,
            address,
            amount: "0",
          });
        } catch (error) {
          console.error("Failed to add token to list:", error);
        }
      }
    };
    addCreatedToken();
  }, [address, addToken, name, symbol, decimals]);

  // Determine which state to show
  const isCreating = creatingToken.creating;
  const hasError = !creatingToken.creating && creatingToken.error;
  const isSuccess = !creatingToken.creating && !creatingToken.error && address;

  return (
    <PageShell
      title={
        <span className="flex items-center gap-2">
          {isCreating && (
            <Loader2
              className="h-5 w-5 shrink-0 animate-spin text-primary"
              aria-hidden="true"
            />
          )}
          {hasError && (
            <XCircle
              className="h-5 w-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
          )}
          {isSuccess && (
            <Check
              className="h-5 w-5 shrink-0 text-success"
              aria-hidden="true"
            />
          )}
          {isCreating
            ? "Creating Token"
            : hasError
              ? "Token Creation Failed"
              : isSuccess
                ? "Token Created"
                : "Token Status"}
        </span>
      }
      seoTitle="Token Status"
    >
      {!isCreating && !hasError && !isSuccess && (
        <Card className="space-y-4 p-6">
          <p className="text-sm text-muted-foreground">
            No token creation in progress.
          </p>
          <Link to={ROUTES.CREATE_TOKEN}>
            <Button>Create Token</Button>
          </Link>
        </Card>
      )}
      {/* Creating State */}
      {isCreating && (
        <Card className="w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="space-y-1">
                <p className="text-lg font-medium">{creatingToken.name}</p>
                <p className="text-sm text-muted-foreground">
                  Deploying your token to the blockchain...
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {hasError && (
        <Card className="w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="space-y-2">
                <p className="text-lg font-medium">Something went wrong</p>
                <p className="text-sm text-muted-foreground max-w-md">
                  {creatingToken.error}
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Link className="w-full" to={ROUTES.CREATE_TOKEN}>
              <Button className="w-full" type="button" variant="outline">
                Try Again
              </Button>
            </Link>
          </CardFooter>
        </Card>
      )}

      {/* Success State */}
      {isSuccess && (
        <Card className="w-full">
          <CardContent className="space-y-6 pt-6">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                Transaction Hash
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={`${explorerUrl}/tx/${tx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 font-medium text-secondary hover:text-secondary/80"
                >
                  {StringUtil.getSplitAddress(tx.toString())}
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  onClick={() => copyToClipboard(tx.toString(), "txHash")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {copiedItem === "txHash" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                Token Address
              </span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-secondary">
                  {StringUtil.getSplitAddress(address)}
                </span>
                <button
                  onClick={() => copyToClipboard(address, "tokenAddress")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {copiedItem === "tokenAddress" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="font-medium text-secondary break-words">
                  {name}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Symbol</span>
                <span className="font-medium text-secondary break-words">
                  {symbol}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Decimals</span>
                <span className="font-numeric font-medium text-secondary">
                  {decimals}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">Block Hash</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-secondary">
                  {StringUtil.getSplitAddress(blockHash.toString())}
                </span>
                <button
                  onClick={() =>
                    copyToClipboard(blockHash.toString(), "blockHash")
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  {copiedItem === "blockHash" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">
                  Block Number
                </span>
                <a
                  href={`${explorerUrl}/block/${blockNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 font-numeric font-medium text-secondary hover:text-secondary/80"
                >
                  {blockNumber.toString()}
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Gas Used</span>
                <span className="font-numeric font-medium text-secondary">
                  {gasInQrl} Quanta
                </span>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Link className="w-full" to={ROUTES.HOME}>
              <Button className="w-full" type="button">
                <Check className="mr-2 h-4 w-4" />
                Done
              </Button>
            </Link>
          </CardFooter>
        </Card>
      )}
    </PageShell>
  );
});

export default TokenStatus;
