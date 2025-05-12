import { SEO } from "@/components/SEO/SEO";

const Privacy = () => {
    return (
        <div className="min-h-screen">
            <SEO
                title="Privacy Policy"
                description="Privacy policy for the MyQRLWallet Web3 Wallet"
            />
            <main className="container mx-auto px-4 py-8">
                <div>
                    <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>

                    <p className="mb-4">
                        Welcome to MyQRLWallet. We are deeply committed to your privacy. This Privacy Policy outlines our approach to your information, emphasizing that our Services are designed to be non-custodial and to collect no personal data or usage information from you.
                    </p>

                    <p className="mb-6">
                        <strong>Last Updated: 14 March 2025</strong> {/* TODO: Update this date or make it dynamic */}
                    </p>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">1. Our Core Privacy Principles</h2>
                    <ul className="list-disc list-inside mb-6">
                        <li><strong>No User Accounts, No Personal Data Collection:</strong> MyQRLWallet does not require you to create an account or provide any personal information to use our core wallet services.</li>
                        <li><strong>No Logging:</strong> We do not log your IP address, browser details, device information, or your activity on our Services.</li>
                        <li><strong>No Cookies or Tracking:</strong> We do not use cookies or any other tracking technologies for advertising or analytics.</li>
                        <li><strong>Non-Custodial:</strong> You, and only you, hold your private keys and control your funds. We never have access to your private keys or mnemonic seed.</li>
                    </ul>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">2. Information Handling</h2>

                    <h3 className="text-xl font-semibold mt-4 mb-2">Information Processed by the Client-Side Application</h3>
                    <p className="mb-4">
                        To interact with the QRL blockchain, the MyQRLWallet client-side application (running in your browser) uses:
                    </p>
                    <ul className="list-disc list-inside mb-6">
                        <li><strong>Your Wallet's Public Address and View Key:</strong> These are used by the application locally on your device to fetch your transaction history and display your balance. This information is necessary for the wallet to function but is not transmitted to or stored by MyQRLWallet's servers.</li>
                        <li><strong>Transaction Data:</strong> When you make a transaction, the details are broadcast directly from your client to the QRL network.</li>
                    </ul>

                    <h3 className="text-xl font-semibold mt-4 mb-2">Information We Explicitly Do Not Collect or Store</h3>
                    <p className="mb-4">
                        To be unequivocally clear, MyQRLWallet servers do NOT collect or store:
                    </p>
                    <ul className="list-disc list-inside mb-6">
                        <li>Your IP Address</li>
                        <li>Browser type, operating system, or device information</li>
                        <li>Access times or pages viewed</li>
                        <li>Error logs that contain personal or identifying information</li>
                        <li>Cookies or any tracking identifiers</li>
                        <li>Your private spend key or mnemonic seed (these should never be shared with anyone, including us)</li>
                    </ul>
                     <p className="mb-6">
                        Any interaction with third-party services (e.g., blockchain explorers linked from the wallet) is subject to their respective privacy policies.
                    </p>


                    <h2 className="text-2xl font-semibold mt-6 mb-3">3. Use of Information</h2>
                    <p className="mb-6">
                        Since we do not collect your personal information, there is no "use" of such information by MyQRLWallet for tracking, analytics, or advertising. The information processed by the client-side application (your public address, view key) is used solely to:
                    </p>
                    <ul className="list-disc list-inside mb-6">
                        <li>Enable you to view your QRL balance and transaction history.</li>
                        <li>Allow you to construct and broadcast transactions to the QRL network.</li>
                        <li>Provide the core functionalities of the MyQRLWallet service as a QRL wallet interface.</li>
                    </ul>
                     <p className="mb-6">
                        If you voluntarily contact us for support (e.g., by opening an issue on GitHub), any information you provide in that communication will be used solely to address your query.
                    </p>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">4. Sharing of Information</h2>
                    <p className="mb-4">
                        MyQRLWallet does not possess or store your personal information, so we do not "share" it in the traditional sense.
                    </p>
                    <ul className="list-disc list-inside mb-6">
                        <li><strong>With the QRL Network:</strong> When you initiate a transaction, your transaction data (including your public address and the recipient's address) is broadcast to the public QRL network. This is an inherent part of how blockchains operate.</li>
                        <li><strong>Legal Obligations:</strong> We will comply with lawful requests if applicable to our service infrastructure itself. However, as we do not hold user data, we would typically have no user-specific information to provide in response to such requests.</li>
                    </ul>
                    <p className="mb-6">
                        We do not share information with vendors, consultants, or for business transfer purposes because we do not collect it in the first place. We do not engage in selling user data as we do not have any.
                    </p>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">5. Security</h2>
                    <p className="mb-6">
                        We are committed to the security of our application code. However, the security of your QRL assets is primarily your responsibility. Because MyQRLWallet is a non-custodial wallet:
                    </p>
                     <ul className="list-disc list-inside mb-6">
                        <li>You are solely responsible for securely storing your mnemonic seed and private keys. Never share them.</li>
                        <li>Be vigilant against phishing attempts and ensure you are using the official MyQRLWallet service.</li>
                    </ul>
                    <p className="mb-6">
                        We do not store your keys or personal information, which significantly reduces the risk of data breaches from our side affecting your direct assets.
                    </p>


                    <h2 className="text-2xl font-semibold mt-6 mb-3">6. Your Control and Rights</h2>
                    <p className="mb-6">
                        You maintain complete control over your information because it's managed by you through your private keys. Since MyQRLWallet does not collect or store your personal information, traditional data subject rights (like requesting access to, correction, or deletion of data held by a service provider) are generally not applicable as there is no data held by us to which these rights would pertain. Your primary "right" is your inherent control over your keys and, by extension, your assets on the QRL blockchain.
                    </p>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">7. Policy Updates</h2>
                     <p className="mb-6">
                        We may update this Privacy Policy from time to time to reflect changes in our practices or for other operational, legal, or regulatory reasons. We will notify you of any significant changes by updating the "Last Updated" date on this page and potentially through announcements on our official communication channels. We encourage you to review this Privacy Policy periodically.
                    </p>


                    <h2 className="text-2xl font-semibold mt-6 mb-3">8. Contact Us</h2>
                    <p className="mb-6">
                        If you have any questions about this Privacy Policy or our privacy practices, please <a target="_blank" href="https://github.com/DigitalGuards/" className="text-blue-600 underline">open an issue in our GitHub repository</a>.
                    </p>
                </div>
            </main>
        </div>
    );
};

export default Privacy;
