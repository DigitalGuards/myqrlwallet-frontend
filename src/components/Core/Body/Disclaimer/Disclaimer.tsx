import { Link } from "react-router-dom";
import { SEO } from "@/components/SEO/SEO";
import { ROUTES } from "@/router/router";

const linkClass =
    "text-blue-accent underline underline-offset-2 hover:text-blue-accent/80 transition-colors";

const Disclaimer = () => {
    return (
        <div className="min-h-screen">
            <SEO
                title="Disclaimer"
                description="Plain-language risk summary for MyQRLWallet, the self-custody wallet for QRL 2.0 by DigitalGuards."
            />
            <main className="container mx-auto max-w-3xl px-4 py-8">
                <h1 className="text-3xl font-bold mb-4">Disclaimer</h1>

                <p className="mb-2 text-sm text-muted-foreground">Last updated: 13 July 2026</p>

                <p className="mb-6">
                    This is a short, plain-language summary of the most important points about MyQRLWallet. It
                    is provided for convenience only. Our{" "}
                    <Link className={linkClass} to={ROUTES.TERMS}>
                        Terms of Use
                    </Link>{" "}
                    govern your use of the software, and in case of any conflict the Terms of Use control.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">What MyQRLWallet is</h2>
                <p className="mb-6">
                    MyQRLWallet is free, open-source, self-custody client software for the QRL 2.0 blockchain.
                    It lets you generate keys on your own device, view your balances, sign transactions locally
                    and broadcast them to the QRL network. It is provided by DigitalGuards.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">You are in sole control of your funds</h2>
                <p className="mb-6">
                    DigitalGuards does not hold, control or have access to your crypto-assets, private keys or
                    recovery phrase, and cannot move, freeze, recover, reverse or return your funds. Your keys
                    and recovery phrase are generated and stored only on your device. If you lose them, no one,
                    including DigitalGuards, can recover them or your funds.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Risks to be aware of</h2>
                <ul className="list-disc list-inside mb-6">
                    <li>Blockchain transactions are irreversible. A transaction sent to a wrong address cannot be undone.</li>
                    <li>You are responsible for safeguarding your device, PIN or password, and recovery phrase.</li>
                    <li>Phishing and malware are real threats. Always verify you are using the official MyQRLWallet.</li>
                    <li>
                        QRL 2.0 is currently a testnet. Testnet tokens have no value and the network may be
                        reset without notice.
                    </li>
                    <li>
                        The QRL network and any third-party contracts, tokens or dApps you interact with are
                        outside our control and may fail or behave unexpectedly.
                    </li>
                </ul>

                <h2 className="text-2xl font-semibold mt-6 mb-3">No fees, no advice</h2>
                <p className="mb-6">
                    DigitalGuards charges no fee for MyQRLWallet. Network fees are paid to the QRL network, not
                    to us. Nothing in MyQRLWallet is financial, investment, legal or tax advice.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Liability</h2>
                <p className="mb-6">
                    Our liability is set out in section 7 of the{" "}
                    <Link className={linkClass} to={ROUTES.TERMS}>
                        Terms of Use
                    </Link>
                    . That section preserves all liability that cannot be excluded under mandatory law,
                    including for death or personal injury, intent or conscious recklessness, and product
                    liability.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Restricted jurisdictions</h2>
                <p className="mb-6">
                    MyQRLWallet may not be used by anyone located in, resident in or acting for a
                    sanctioned jurisdiction or by any sanctioned person. The full sanctions terms are in
                    section 5 of the{" "}
                    <Link className={linkClass} to={ROUTES.TERMS}>
                        Terms of Use
                    </Link>
                    .
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Who we are and how to reach us</h2>
                <p className="mb-6">
                    MyQRLWallet is a product of DigitalGuards (eenmanszaak, Netherlands), KvK 91987482. Full
                    details are in the{" "}
                    <Link className={linkClass} to={ROUTES.LEGAL}>
                        Imprint
                    </Link>
                    . To report a security issue, see our{" "}
                    <Link className={linkClass} to={ROUTES.SECURITY}>
                        Security Policy
                    </Link>{" "}
                    or email security@digitalguards.nl.
                </p>
            </main>
        </div>
    );
};

export default Disclaimer;
