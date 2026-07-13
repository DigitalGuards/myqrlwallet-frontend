import { Link } from "react-router-dom";
import { SEO } from "@/components/SEO/SEO";
import { ROUTES } from "@/router/router";

const linkClass =
    "text-blue-accent underline underline-offset-2 hover:text-blue-accent/80 transition-colors";

const Privacy = () => {
    return (
        <div className="min-h-screen">
            <SEO
                title="Privacy Policy"
                description="How DigitalGuards processes personal data in connection with MyQRLWallet, the self-custody wallet for QRL 2.0."
            />
            <main className="container mx-auto max-w-3xl px-4 py-8">
                <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>

                <p className="mb-2 text-sm text-muted-foreground">Last updated: 13 July 2026</p>

                <p className="mb-6">
                    MyQRLWallet is self-custody client software. It is designed to process as little personal
                    data as possible. This policy explains, honestly and specifically, what personal data is
                    processed when you use MyQRLWallet, why, on what legal basis, who receives it, and what
                    rights you have. It applies to the MyQRLWallet web wallet (qrlwallet.com), desktop
                    application, mobile application and browser extension.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">1. Who is the controller</h2>
                <p className="mb-6">
                    The controller for the processing described here is DigitalGuards, a sole proprietorship
                    (eenmanszaak) established in the Netherlands, Oude Boekeloseweg 31, 7553 DS Hengelo,
                    Netherlands, registered with the Chamber of Commerce (KvK) under number 91987482. For any
                    privacy question or to exercise your rights, contact security@digitalguards.nl. Please do
                    not use a public GitHub issue for requests that contain personal data.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">2. What stays on your device</h2>
                <p className="mb-4">
                    MyQRLWallet is non-custodial. The following are created and kept on your own device and are
                    never sent to, or accessible by, DigitalGuards:
                </p>
                <ul className="list-disc list-inside mb-4">
                    <li>
                        your recovery (seed) phrase and your ML-DSA-87 signature keys, which are generated
                        locally and, where you set a PIN or password, stored encrypted in your device's local
                        storage;
                    </li>
                    <li>
                        your wallet settings, preferences and address book, which are stored in your device's
                        local storage.
                    </li>
                </ul>
                <p className="mb-6">
                    This on-device data is under your control. It is not transmitted to our servers, and it is
                    not covered by the data-subject request process below because we never receive it. QRL 2.0
                    uses ML-DSA-87 signatures and does not use "view keys", "spend keys" or any similar concept.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">3. What is processed when you connect</h2>
                <p className="mb-4">
                    To read public blockchain data and to broadcast transactions that you have already signed
                    on your device, MyQRLWallet connects to internet infrastructure. This necessarily involves
                    some processing of personal data in transit. We do not pretend otherwise.
                </p>
                <h3 className="text-xl font-semibold mt-4 mb-2">3.1 Your IP address</h3>
                <ul className="list-disc list-inside mb-4">
                    <li>
                        Our content delivery network and security provider, Cloudflare, sits in front of our
                        websites and endpoints. Cloudflare receives and processes your real IP address at its
                        edge, on our instruction, in order to deliver the sites and to protect them against
                        denial-of-service and abuse.
                    </li>
                    <li>
                        Our RPC proxy and our dApp Connect relay process your IP address transiently, in
                        memory, to enforce rate limits. Where a security-relevant event occurs (for example a
                        blocked method, an error or an unusually slow request), an entry that can include your
                        IP address is written to our operational logs.
                    </li>
                    <li>
                        Our origin web server keeps standard access logs. In normal operation these record the
                        connecting address (which is usually Cloudflare's proxy address rather than your own),
                        together with the requested path, timestamp, HTTP status, referrer and user-agent.
                    </li>
                </ul>
                <h3 className="text-xl font-semibold mt-4 mb-2">3.2 Your public address and signed transactions</h3>
                <p className="mb-4">
                    When you view your balance or history, or broadcast a transaction, your public wallet
                    address and, for a broadcast, your already-signed transaction are sent to our RPC proxy and,
                    for balance, history, token and NFT data, to the ZondScan block explorer. These endpoints
                    necessarily observe that public data in transit in order to answer your request. A signed
                    transaction is then relayed to the public QRL network, where, by the nature of a public
                    blockchain, it and the addresses involved become publicly visible.
                </p>
                <h3 className="text-xl font-semibold mt-4 mb-2">3.3 Support communications</h3>
                <p className="mb-6">
                    If you choose to contact us, we process the information you provide solely to handle your
                    request.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">4. Legal bases</h2>
                <p className="mb-6">
                    We rely on our legitimate interests (Article 6(1)(f) GDPR) in securing our infrastructure,
                    preventing abuse and enforcing rate limits, and in providing the software and endpoints you
                    have chosen to use. We do not rely on consent because we do not carry out any processing
                    that would require it: there is no analytics, advertising or tracking. A dynamic IP address
                    can be personal data (Court of Justice of the European Union, Breyer, C-582/14), and we
                    treat it as such.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">5. What we do not do</h2>
                <ul className="list-disc list-inside mb-6">
                    <li>We do not use analytics, telemetry, crash reporting or usage tracking.</li>
                    <li>We do not use advertising or tracking cookies, and we do not profile you.</li>
                    <li>We do not sell, rent or share your data for marketing.</li>
                    <li>
                        We do not link your IP address to your wallet address to identify you, and we do not
                        retain the data that would be needed to do so. An endpoint that sees an IP address at
                        the same time as a queried public address could in principle link the two; we do not,
                        and our short log retention is designed to prevent it.
                    </li>
                    <li>We never receive your recovery phrase or private keys.</li>
                </ul>

                <h2 className="text-2xl font-semibold mt-6 mb-3">6. Recipients and processors</h2>
                <ul className="list-disc list-inside mb-6">
                    <li>
                        <strong>Cloudflare, Inc. (United States):</strong> our CDN, DNS and security provider,
                        acting as our processor. It sees your real IP address and request metadata at the edge.
                    </li>
                    <li>
                        <strong>Hetzner Online GmbH (Germany, EU):</strong> our hosting provider, which
                        operates the origin servers and carries out network-level logging as part of hosting.
                    </li>
                    <li>
                        <strong>ZondScan (operated by DigitalGuards, behind Cloudflare):</strong> the block
                        explorer that the wallet queries for balances, history, token and NFT data. It observes
                        your IP address and the public addresses you query. ZondScan is a separate service with
                        its own privacy policy.
                    </li>
                    <li>
                        <strong>The public QRL network:</strong> broadcast transactions and the addresses they
                        involve become part of the public ledger. This is inherent to any public blockchain and
                        is not controlled by us.
                    </li>
                </ul>

                <h2 className="text-2xl font-semibold mt-6 mb-3">7. International transfers</h2>
                <p className="mb-6">
                    Cloudflare is established in the United States, so using our sites involves a transfer of
                    your IP address and request metadata to a third country. That transfer is covered by the
                    data processing agreement and the appropriate safeguards (Standard Contractual Clauses
                    and/or the EU-US Data Privacy Framework) that apply to our use of Cloudflare. Our origin
                    servers are located in the European Union.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">8. Retention</h2>
                <ul className="list-disc list-inside mb-6">
                    <li>Origin web-server access logs are retained for up to 14 days, then deleted.</li>
                    <li>
                        Operational and security logs that may contain an IP address are retained for no longer
                        than 30 days, then deleted.
                    </li>
                    <li>
                        In-memory rate-limiting state is transient and is reset on a short rolling window; it is
                        not written to persistent storage.
                    </li>
                    <li>Cloudflare retains edge data according to its own retention periods.</li>
                </ul>

                <h2 className="text-2xl font-semibold mt-6 mb-3">9. Cookies and local storage</h2>
                <p className="mb-6">
                    MyQRLWallet does not use tracking or advertising cookies. It uses your browser's local
                    storage to hold your wallet data (such as encrypted seeds, settings and your address book)
                    on your own device. That local-storage data is not transmitted to us.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">10. Your rights</h2>
                <p className="mb-4">
                    To the extent we process your personal data, you have the right to request access to it,
                    and its rectification, erasure or restriction, to object to processing, and to data
                    portability. In practice, because we hold very little data and do not link it to your
                    identity, we may be unable to isolate data relating to you without additional information
                    from you (Article 11 GDPR). To make a request, contact security@digitalguards.nl.
                </p>
                <p className="mb-6">
                    You also have the right to lodge a complaint with the Dutch supervisory authority, the
                    Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl), or with the supervisory
                    authority of your own country of residence.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">11. Third-party sites and children</h2>
                <p className="mb-4">
                    Links to third-party sites, block explorers and decentralised applications are subject to
                    those parties' own privacy policies. We do not control them.
                </p>
                <p className="mb-6">
                    MyQRLWallet is not directed at children, and we do not knowingly process the personal data
                    of children.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">12. Changes and contact</h2>
                <p className="mb-6">
                    We may update this policy to reflect changes in our practices or the law, and will post the
                    amended version with a new "Last updated" date. For any question about this policy, or to
                    exercise your rights, contact security@digitalguards.nl. See also our{" "}
                    <Link className={linkClass} to={ROUTES.TERMS}>
                        Terms of Use
                    </Link>{" "}
                    and{" "}
                    <Link className={linkClass} to={ROUTES.SECURITY}>
                        Security Policy
                    </Link>
                    .
                </p>
            </main>
        </div>
    );
};

export default Privacy;
