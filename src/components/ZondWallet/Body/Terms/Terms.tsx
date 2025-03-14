import { SEO } from "@/components/SEO/SEO";
import terms from "./terms.md?raw";
import Markdown from "react-markdown";

const Terms = () => {
    return (
        <div className="min-h-screen bg-white text-black">
            <SEO
                title="Terms of Service"
                description="Terms of service for the QRL Zond Web3 Wallet"
            />
            <main className="container mx-auto px-4 py-8">
                <div className="prose prose-sm prose-slate max-w-none">
                    <Markdown>{terms}</Markdown>
                </div>
            </main>
        </div>
    );
};

export default Terms;
