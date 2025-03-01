import { observer } from "mobx-react-lite";
import { TokenForm } from "./TokenForm/TokenForm";
import { useStore } from "@/stores/store";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";

const Tokens = observer(() => {
    const { zondStore } = useStore();
    const { activeAccount } = zondStore;
    const navigate = useNavigate();
    useEffect(() => {
        if (!activeAccount.accountAddress) {
            toast({
                title: 'Please add an account to continue',
                variant: 'destructive',
            });
            navigate('/add-account');
        }
    }, [activeAccount]);
    return (
        <div className="flex w-full items-start justify-center py-16">
            <div className="relative w-full max-w-2xl px-4">
                <img
                    className="fixed left-0 top-0 z-0 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-30"
                    src="/tree.svg"
                    alt="Background Tree"
                />
                <div className="relative z-10">
                    <TokenForm />
                </div>
            </div>
        </div>
    );
});

export default Tokens;
