import { observer } from "mobx-react-lite";
import { TokenCreationForm } from "./TokenCreationForm/TokenCreationForm";
import { useStore } from "@/stores/store";

const CreateToken = observer(() => {
    const { zondStore } = useStore();
    const {
        createToken
    } = zondStore;
    
    const onTokenCreated = async (tokenName: string, tokenSymbol: string, initialSupply: number, decimals: number, maxSupply: undefined | number, initialRecipient: undefined | string, tokenOwner: undefined | string, maxWalletAmount: undefined | number, maxTransactionLimit: undefined | number, mnemonicPhrases: string) => {
        
        if(!initialRecipient) {
            initialRecipient = "0x0000000000000000000000000000000000000000";
        }

        if(!tokenOwner) {
            tokenOwner = "0x0000000000000000000000000000000000000000";
        }

        if(!maxSupply) {
            maxSupply = 0;
        }

        if(!maxWalletAmount) {
            maxWalletAmount = 0;
        }

        if(!maxTransactionLimit) {
            maxTransactionLimit = 0;
        }
        
        await createToken(
            tokenName,
            tokenSymbol,
            initialSupply.toString(),
            decimals,
            maxSupply.toString(),
            initialRecipient,
            tokenOwner,
            maxWalletAmount.toString(),
            maxTransactionLimit.toString(),
            mnemonicPhrases
        )  
    };

    return (
        <div className="flex w-full items-start justify-center py-16">
            <div className="relative w-full max-w-2xl px-4">
                <img
                    className="fixed left-0 top-0 z-0 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-30"
                    src="/tree.svg"
                    alt="Background Tree"
                />
                <div className="relative z-10">
                    <TokenCreationForm onTokenCreated={onTokenCreated} />
                </div>
            </div>
        </div>
    );
});

export default CreateToken;
