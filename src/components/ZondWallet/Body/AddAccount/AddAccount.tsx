import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { withSuspense } from "@/utils/react";

const AccountCreateImport = withSuspense(
    lazy(() => import("../Home/AccountCreateImport/AccountCreateImport"))
);

const CreateToken = observer(() => {

    return (
        <div className="flex w-full items-start justify-center py-8">
            <div className="relative w-full max-w-2xl px-4">
                <img
                    className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
                    src="/tree.svg"
                    alt="Background Tree"
                />
                <div className="relative z-10">
                    <AccountCreateImport />
                </div>
            </div>
        </div>
    );
});

export default CreateToken;
