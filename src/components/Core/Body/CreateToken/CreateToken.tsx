import { observer } from "mobx-react-lite";
import { TokenCreationForm } from "./TokenCreationForm/TokenCreationForm";
import { useStore } from "@/stores/store";
import { SEO } from "@/components/SEO/SEO";

const CreateToken = observer(() => {
    const { qrlStore } = useStore();
    const {
        createToken,
    } = qrlStore;

    const onTokenCreated = async (tokenName: string, tokenSymbol: string, initialSupply: string, decimals: number, maxSupply: undefined | string, initialRecipient: undefined | string, maxWalletAmount: undefined | string, maxTransactionLimit: undefined | string, mnemonicPhrases: string) => {

        if (!initialRecipient) {
            initialRecipient = "Q0000000000000000000000000000000000000000";
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
            mnemonicPhrases
        );
    };

    return (
        <>
            <SEO title="Create QRC20 Token" />
            <div className="flex w-full items-start justify-center py-2 md:py-8">
                <div className="relative w-full max-w-2xl px-2 md:px-4">
                    <img
                        className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
                        src="/tree.svg"
                        alt="Background Tree"
                    />
                    <div className="relative z-10">
                        <TokenCreationForm onTokenCreated={onTokenCreated} />
                    </div>
                </div>
            </div>
        </>
    );
});

export default CreateToken;
