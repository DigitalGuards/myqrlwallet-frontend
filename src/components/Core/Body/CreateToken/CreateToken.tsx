import { PageShell } from "@/components/Core/Layout/PageShell";
import { observer } from "mobx-react-lite";
import { TokenCreationForm } from "./TokenCreationForm/TokenCreationForm";
import { useStore } from "@/stores/store";
import { QRL_ZERO_ADDRESS } from "@/utils/web3";

const CreateToken = observer(() => {
  const { tokenStore } = useStore();
  const { createToken } = tokenStore;

  const onTokenCreated = async (
    tokenName: string,
    tokenSymbol: string,
    initialSupply: string,
    decimals: number,
    maxSupply: undefined | string,
    initialRecipient: undefined | string,
    maxWalletAmount: undefined | string,
    maxTransactionLimit: undefined | string,
    mnemonicPhrases: string,
  ) => {
    if (!initialRecipient) {
      initialRecipient = QRL_ZERO_ADDRESS;
    }

    // Factory requires maxSupply > 0 and maxSupply >= initialSupply.
    // Default to initialSupply so "leave blank" means "fixed supply".
    if (!maxSupply) {
      maxSupply = initialSupply;
    }

    if (!maxWalletAmount) {
      maxWalletAmount = "0";
    }

    if (!maxTransactionLimit) {
      maxTransactionLimit = "0";
    }

    await createToken(
      tokenName,
      tokenSymbol,
      initialSupply,
      decimals,
      maxSupply,
      initialRecipient,
      maxWalletAmount,
      maxTransactionLimit,
      mnemonicPhrases,
    );
  };

  return (
    <>
      <PageShell
        title="Create New QRC20 Token"
        subtitle="Deploy your own QRC20 token on the QRL network"
        seoTitle="Create QRC20 Token"
      >
        <div className="relative z-10">
          <TokenCreationForm onTokenCreated={onTokenCreated} />
        </div>
      </PageShell>
    </>
  );
});

export default CreateToken;
