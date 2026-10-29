import type { ReactNode } from "react";
import type { ParseKeys, TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { isQuantaVaultOrigin } from "@/config/quantaVault";
import type { TokenInterface } from "@/constants/tokens";
import { formatUnits } from "@/utils/web3/units";
import { formatQuantaValue } from "@/utils/formatting";
import { normalizeQrlAddress } from "@/utils/web3/address";
import {
  hasVaultRefund,
  VAULT_MAX_UINT256,
  type VaultRequest,
} from "@/utils/signing/quantaVault";
import {
  decodeVaultCall,
  vaultRoleLabel,
  type DecodedVaultCall,
  type VaultArgument,
  type VaultAbiValue,
  type VaultCallWarning,
} from "@/utils/signing/quantaVaultCalldata";
import { reviewValueKey } from "./reviewIdentity";
import { chainNumber, escapeVisualControls } from "./typedDataReview";

type Key = ParseKeys<["dapps"]>;
const ARGUMENT_LABELS: Readonly<Record<string, Key>> = {
  _data: "dapps:message",
  _threshold: "dapps:vaultThreshold",
  account: "dapps:vaultAccount",
  amount: "dapps:vaultAmount",
  baseGas: "dapps:vaultBaseGas",
  calldataPayload: "dapps:data",
  callerConfirmation: "dapps:vaultAccount",
  data: "dapps:data",
  delay: "dapps:vaultDelay",
  gasPrice: "dapps:vaultGasPrice",
  gasToken: "dapps:vaultGasToken",
  guard: "dapps:vaultGuard",
  handler: "dapps:vaultHandler",
  hashToApprove: "dapps:vaultHash",
  id: "dapps:vaultOperationId",
  module: "dapps:vaultModule",
  moduleGuard: "dapps:vaultModuleGuard",
  newDelay: "dapps:vaultDelay",
  newOwner: "dapps:vaultNewOwner",
  oldOwner: "dapps:vaultOldOwner",
  operation: "dapps:vaultOperation",
  owner: "dapps:vaultOwner",
  payload: "dapps:data",
  payloads: "dapps:data",
  predecessor: "dapps:vaultPredecessor",
  prevModule: "dapps:vaultPreviousModule",
  prevOwner: "dapps:vaultPreviousOwner",
  recipient: "dapps:to",
  refundReceiver: "dapps:vaultRefundReceiver",
  role: "dapps:vaultRole",
  safeTxGas: "dapps:vaultTxGas",
  salt: "dapps:vaultSalt",
  sender: "dapps:vaultSender",
  signatures: "dapps:vaultSignatures",
  spender: "dapps:vaultSpender",
  target: "dapps:to",
  targetContract: "dapps:to",
  targets: "dapps:to",
  to: "dapps:to",
  transactions: "dapps:data",
  validUntil: "dapps:vaultExpiry",
  value: "dapps:value",
  values: "dapps:value",
};
const WARNING_KEYS: Record<VaultCallWarning, Key> = {
  unknownCalldata: "dapps:vaultUnknownWarning",
  invalidCalldata: "dapps:vaultInvalidWarning",
  invalidOperation: "dapps:vaultInvalidOperationWarning",
  depthLimit: "dapps:vaultDepthWarning",
  securityChange: "dapps:vaultSecurityWarning",
  delegateCall: "dapps:vaultDelegateWarning",
  opaqueApproval: "dapps:vaultOpaqueWarning",
  openRole: "dapps:vaultOpenRole",
  unlimitedAllowance: "dapps:vaultUnlimitedAllowance",
};

/** ABI decoding yields lowercase hex; every address shows its QIP-55 checksum case. */
function VaultAddress({ address }: { address: string }) {
  return (
    <QrlAddress
      address={normalizeQrlAddress(address) ?? address}
      mode="full"
      addressClassName="text-xs"
    />
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value: unknown;
  children: ReactNode;
}) {
  return (
    <dl
      data-review-block
      data-review-value={reviewValueKey(value)}
      className="space-y-1"
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-sm" dir="auto">
        {children}
      </dd>
    </dl>
  );
}

function Warning({
  children,
  blocking = false,
}: {
  children: ReactNode;
  blocking?: boolean;
}) {
  return (
    <p
      id={blocking ? "vault-refund-error" : undefined}
      data-review-block
      role="alert"
      className={
        blocking
          ? "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm font-semibold text-destructive"
          : "rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400"
      }
    >
      {children}
    </p>
  );
}

function operationLabel(value: bigint, t: TFunction<["dapps"]>): string {
  return value === 0n
    ? t("vaultCall")
    : value === 1n
      ? t("vaultDelegateCall")
      : t("vaultInvalidOperation", { value: value.toString() });
}

function expiryLabel(
  value: bigint,
  language: string,
  t: TFunction<["dapps"]>,
): string {
  const milliseconds = value * 1000n;
  if (milliseconds > 8640000000000000n)
    return t("vaultDateRange", { value: value.toString() });
  return t("vaultLocalDate", {
    date: new Date(Number(milliseconds)).toLocaleString(language),
  });
}

function tokenAmount(
  value: bigint,
  token: TokenInterface | undefined,
  t: TFunction<["dapps"]>,
): string {
  const decimals =
    typeof token?.decimals === "number"
      ? token.decimals
      : typeof token?.decimals === "string" && /^\d{1,3}$/.test(token.decimals)
        ? Number(token.decimals)
        : undefined;
  if (
    decimals === undefined ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    typeof token?.symbol !== "string" ||
    !token.symbol.trim() ||
    token.symbol.length > 64
  )
    return t("vaultRawAmount", { value: value.toString() });
  return t("vaultTokenAmount", {
    value: formatUnits(value, decimals),
    symbol: escapeVisualControls(token.symbol),
  });
}

function argumentValue(
  value: VaultAbiValue,
  arg: VaultArgument,
  token: TokenInterface | undefined,
  language: string,
  t: TFunction<["dapps"]>,
): ReactNode {
  if (typeof value !== "string" && typeof value !== "bigint")
    return (
      <ol className="space-y-2">
        {value.map((entry, i) => (
          <li key={i} className="space-y-1">
            <span className="text-xs text-muted-foreground">{i + 1}</span>
            <div>
              {argumentValue(
                entry,
                {
                  ...arg,
                  type:
                    arg.type === "address[]"
                      ? "address"
                      : arg.type === "uint256[]"
                        ? "uint256"
                        : "bytes",
                },
                token,
                language,
                t,
              )}
            </div>
          </li>
        ))}
      </ol>
    );
  if (typeof value === "bigint") {
    if (arg.name === "operation") return operationLabel(value, t);
    if (arg.name === "amount") return tokenAmount(value, token, t);
    if (arg.name === "value" || arg.name === "values")
      return formatQuantaValue(value);
    if (arg.name === "delay" || arg.name === "newDelay")
      return t("vaultDuration", {
        days: (value / 86400n).toString(),
        hours: ((value / 3600n) % 24n).toString(),
        minutes: ((value / 60n) % 60n).toString(),
        seconds: (value % 60n).toString(),
        value: value.toString(),
      });
    if (arg.name === "validUntil") return expiryLabel(value, language, t);
    return value.toString();
  }
  if (arg.type === "address") return <VaultAddress address={value} />;
  if (arg.name === "role")
    return (
      <span className="font-mono text-xs">
        {vaultRoleLabel(value)} {value}
      </span>
    );
  return (
    <pre
      data-review-block
      className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs"
      dir="ltr"
    >
      {value}
    </pre>
  );
}

function CallReview({
  call,
  tokens,
  language,
}: {
  call: DecodedVaultCall;
  tokens: readonly TokenInterface[];
  language: string;
}) {
  const { t } = useTranslation(["dapps"]);
  const token = tokens.find(
    (entry) => entry.address.toLowerCase() === call.to.toLowerCase(),
  );
  return (
    <div className="space-y-3">
      <Row label={t("to")} value={call.to}>
        <VaultAddress address={call.to} />
      </Row>
      {call.batchTarget && (
        <p data-review-block className="text-xs text-muted-foreground">
          {t("vaultZeroTarget")}
        </p>
      )}
      <Row label={t("value")} value={call.value}>
        {formatQuantaValue(call.value)}
      </Row>
      <Row label={t("vaultOperation")} value={call.operation}>
        {operationLabel(call.operation, t)}
      </Row>
      {call.warnings.map((warning, index) => (
        <Warning key={`${warning}-${index}`}>
          {t(WARNING_KEYS[warning])}
        </Warning>
      ))}
      {call.method && (
        <Row label={t("vaultFunction")} value={call.data}>
          <span className="font-mono">{call.method}</span>
        </Row>
      )}
      {call.args.map((arg) => (
        <Row
          key={arg.name}
          label={t(ARGUMENT_LABELS[arg.name] ?? "data")}
          value={arg}
        >
          {argumentValue(arg.value, arg, token, language, t)}
        </Row>
      ))}
      {call.status === "empty" && (
        <p data-review-block className="text-xs text-muted-foreground">
          {t("vaultNoData")}
        </p>
      )}
      {(call.status === "unknown" || call.status === "invalid") && (
        <Row label={t("data")} value={call.data}>
          <pre
            data-review-block
            className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs"
            dir="ltr"
          >
            {call.data}
          </pre>
        </Row>
      )}
      {call.children.map((child, i) => (
        <div key={i} className="space-y-3 border-t border-border pt-3">
          <p data-review-block className="font-medium">
            {t("vaultInnerCall", { index: i + 1 })}
          </p>
          <CallReview call={child} tokens={tokens} language={language} />
        </div>
      ))}
    </div>
  );
}

interface Props {
  request: VaultRequest;
  connectedChainId?: string;
  origin?: string;
  knownTokens?: readonly TokenInterface[];
}

const DAppVaultReview = ({
  request,
  connectedChainId,
  origin = "",
  knownTokens = [],
}: Props) => {
  const { t, i18n } = useTranslation(["dapps"]);
  const connectedChain = chainNumber(connectedChainId);
  const tokens = connectedChain === request.chainId ? knownTokens : [];
  const title =
    request.kind === "VaultMessage"
      ? "dapps:vaultMessage"
      : request.kind === "VaultApproval"
        ? "dapps:vaultApproval"
        : "dapps:vaultTransaction";
  const tx = request.kind === "VaultMessage" ? null : request.tx;
  const now = BigInt(Math.floor(Date.now() / 1000));
  return (
    <div className="space-y-3">
      <p data-review-block className="font-semibold">
        {t(title)}
      </p>
      <Row label={t("vaultAddress")} value={request.vault}>
        <VaultAddress address={request.vault} />
      </Row>
      {request.kind === "VaultApproval" && (
        <Row label={t("vaultOuter")} value={request.outerVault}>
          <VaultAddress address={request.outerVault} />
        </Row>
      )}
      <Row label={t("vaultNetwork")} value={request.chainId}>
        {request.chainId.toString()}
      </Row>
      {connectedChain !== undefined && connectedChain !== request.chainId && (
        <Warning>
          {t("chainMismatch", {
            domain: request.chainId.toString(),
            connected: connectedChain.toString(),
          })}
        </Warning>
      )}
      <Row label={t("vaultOrigin")} value={origin}>
        {escapeVisualControls(origin) || t("unknownValue")}
      </Row>
      {!isQuantaVaultOrigin(origin) && (
        <Warning>{t("vaultOriginWarning")}</Warning>
      )}
      {request.kind === "VaultMessage" && (
        <>
          {request.message.length === 130 && (
            <Warning>{t("vaultOpaqueWarning")}</Warning>
          )}
          <Row label={t("message")} value={request.message}>
            <pre
              data-review-block
              className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs"
              dir="ltr"
            >
              {request.message}
            </pre>
          </Row>
        </>
      )}
      {tx && (
        <>
          {hasVaultRefund(tx) && (
            <Warning blocking>{t("vaultRefundError")}</Warning>
          )}
          <CallReview
            call={decodeVaultCall(
              tx,
              request.chainId,
              request.kind === "VaultApproval"
                ? request.outerVault
                : request.vault,
            )}
            tokens={tokens}
            language={i18n.language}
          />
          <Row label={t("vaultNonce")} value={tx.nonce}>
            {tx.nonce.toString()}
          </Row>
          <Row label={t("vaultExpiry")} value={tx.validUntil}>
            {expiryLabel(tx.validUntil, i18n.language, t)}
          </Row>
          {tx.validUntil < now && <Warning>{t("vaultExpiredWarning")}</Warning>}
          {tx.validUntil === VAULT_MAX_UINT256 ? (
            <Warning>{t("vaultMaxValidity")}</Warning>
          ) : (
            tx.validUntil > now + 30n * 86400n && (
              <Warning>{t("vaultLongValidity")}</Warning>
            )
          )}
          <Row label={t("vaultTxGas")} value={tx.txGas}>
            {tx.txGas.toString()}
          </Row>
          <p data-review-block className="text-xs text-muted-foreground">
            {t("vaultGasInfo")}
          </p>
          {tx.txGas !== 0n && <Warning>{t("vaultTxGasWarning")}</Warning>}
          <Row label={t("vaultBaseGas")} value={tx.baseGas}>
            {tx.baseGas.toString()}
          </Row>
          <Row label={t("vaultGasPrice")} value={tx.gasPrice}>
            {tx.gasPrice.toString()}
          </Row>
          <Row label={t("vaultGasToken")} value={tx.gasToken}>
            <VaultAddress address={tx.gasToken} />
          </Row>
          <Row label={t("vaultRefundReceiver")} value={tx.refundReceiver}>
            <VaultAddress address={tx.refundReceiver} />
          </Row>
          <p data-review-block className="text-xs text-muted-foreground">
            {t("vaultSelectorHint")}
          </p>
        </>
      )}
    </div>
  );
};

export default DAppVaultReview;
