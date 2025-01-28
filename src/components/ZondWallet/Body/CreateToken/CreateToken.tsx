import { observer } from "mobx-react-lite";
import { TokenCreationForm } from "./TokenCreationForm/TokenCreationForm";

const CreateToken = observer(() => {
  
    const onTokenCreated = async (tokenName: string, tokenSymbol: string, initialSupply: number, decimals: number, maxSupply: undefined | number, initialRecipient: undefined | string, tokenOwner: undefined | string, maxWalletAmount: undefined | number, maxTransactionLimit: undefined | number) => {
        console.log(tokenName, tokenSymbol, initialSupply, decimals, maxSupply, initialRecipient, tokenOwner, maxWalletAmount, maxTransactionLimit)
        
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
