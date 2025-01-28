import { observer } from "mobx-react-lite";
import { TokenSendingForm } from "./SendTokenForm/SendTokenForm";

const CreateToken = observer(() => {
    const onTokenSent = async (tokenAddress: string, toAddress: string, amount: number) => {
        console.log(tokenAddress, toAddress, amount);

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
                    <TokenSendingForm onTokenSent={onTokenSent} />
                </div>
            </div>
        </div>
    );
});

export default CreateToken;
