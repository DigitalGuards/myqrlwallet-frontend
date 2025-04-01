import { observer } from "mobx-react-lite";
import { TokenCreationForm } from "./TokenCreationForm/TokenCreationForm";
import { useStore } from "@/stores/store";

const CreateToken = observer(() => {
    const { zondStore } = useStore();
    const {
        createToken,
    } = zondStore;

    const onTokenCreated = async (tokenName: string, tokenSymbol: string, initialSupply: string, decimals: number, maxSupply: undefined | string, initialRecipient: undefined | string, tokenOwner: undefined | string, maxWalletAmount: undefined | string, maxTransactionLimit: undefined | string, mnemonicPhrases: string) => {

        if (!initialRecipient) {
            initialRecipient = "Z0000000000000000000000000000000000000000";
        }

        if (!tokenOwner) {
            tokenOwner = "Z0000000000000000000000000000000000000000";
        }

        if (!maxSupply) {
            maxSupply = "0";
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
            tokenOwner,
            maxWalletAmount,
            maxTransactionLimit,
            mnemonicPhrases
        );
    };

    return (
        <div className="flex w-full items-start justify-center py-8">
            <div className="relative w-full max-w-2xl px-4">
                {/* <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    className={"fixed left-0 top-0 z-0 h-96 w-96 -translate-x-8 scale-150 overflow-hidden"}
                >
                    <source src="/tree.mp4" type="video/mp4" />
                </video> */}
                <div className="relative z-10">
                    <TokenCreationForm onTokenCreated={onTokenCreated} />
                </div>
            </div>
        </div>
    );
});

export default CreateToken;
