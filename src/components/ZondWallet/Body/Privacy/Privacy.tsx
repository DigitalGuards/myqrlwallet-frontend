import { SEO } from "@/components/SEO/SEO";

const Privacy = () => {
    return (
        <div className="min-h-screen bg-background">
            <SEO
                title="Privacy Policy"
                description="Privacy policy for the QRL Zond Web3 Wallet"
            />
            <main className="container mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
                {/* Add your privacy content here */}
            </main>
        </div>
    );
};

export default Privacy;
