import { SEO } from "@/components/SEO/SEO";
import privacy from "./privacy.md?raw";
import Markdown from "react-markdown";

const Privacy = () => {
    return (
        <div className="min-h-screen bg-white text-black">
            <SEO
                title="Privacy Policy"
                description="Privacy policy for the QRL Zond Web3 Wallet"
            />
            <main className="container mx-auto px-4 py-8">
                <div className="prose prose-sm prose-slate max-w-none">
                    <Markdown>{privacy}</Markdown>
                </div>
            </main>
        </div>
    );
};

export default Privacy;
