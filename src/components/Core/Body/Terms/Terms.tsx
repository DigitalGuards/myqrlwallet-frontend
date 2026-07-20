import { Link } from "react-router-dom";
import { SEO } from "@/components/SEO/SEO";
import { ROUTES } from "@/router/router";

const linkClass =
    "text-identity-accent underline underline-offset-2 hover:text-identity-accent/80 transition-colors";

const Terms = () => {
    return (
        <div className="min-h-screen">
            <SEO
                title="Terms of Use"
                description="Terms of Use for MyQRLWallet, the free and open-source self-custody wallet for QRL 2.0, provided by DigitalGuards."
            />
            <main className="container mx-auto max-w-3xl px-4 py-8">
                <h1 className="text-3xl font-bold mb-4">Terms of Use</h1>

                <p className="mb-2 text-sm text-muted-foreground">Last updated: 13 July 2026</p>

                <p className="mb-6">
                    These Terms of Use (the "Terms") govern your use of the MyQRLWallet software and the
                    websites at qrlwallet.com and myqrlwallet.com (together, "MyQRLWallet"). MyQRLWallet is a
                    product name. The contracting party is DigitalGuards, a sole proprietorship
                    (eenmanszaak) established in the Netherlands ("DigitalGuards", "we", "us" or "our"). By
                    downloading, installing or using MyQRLWallet you agree to these Terms. If you do not
                    agree, do not use the software.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">1. Who we are</h2>
                <p className="mb-4">
                    MyQRLWallet is a product provided by DigitalGuards. Our full statutory details are set
                    out in the{" "}
                    <Link className={linkClass} to={ROUTES.LEGAL}>
                        Imprint
                    </Link>
                    . In summary:
                </p>
                <ul className="list-disc list-inside mb-4">
                    <li>Trade name: DigitalGuards (eenmanszaak, Netherlands)</li>
                    <li>Address: Oude Boekeloseweg 31, 7553 DS Hengelo, Netherlands</li>
                    <li>KvK (Chamber of Commerce) number: 91987482</li>
                    <li>Vestigingsnummer: 000057637466</li>
                    <li>General contact: info@digitalguards.nl</li>
                    <li>Security and privacy contact: security@digitalguards.nl</li>
                </ul>
                <p className="mb-6">
                    MyQRLWallet is a product name and DigitalGuards is the contracting party. References to
                    "MyQRLWallet" as a provider in any older material should be read as references to
                    DigitalGuards.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">2. Nature of the software</h2>
                <p className="mb-4">
                    This section describes what MyQRLWallet is and, importantly, what it is not. It reflects
                    how the software actually works.
                </p>
                <ul className="list-disc list-inside mb-4">
                    <li>
                        <strong>Self-custody client software.</strong> MyQRLWallet is client software that
                        runs on your own device (in your browser, in the desktop application, in the mobile
                        application or in the browser extension). There is no account, no registration, no
                        login and no assignment of keys by us.
                    </li>
                    <li>
                        <strong>Keys stay on your device.</strong> Your private keys and recovery (seed)
                        phrase are generated and stored exclusively on your own device, using your device's
                        cryptographically secure random number generator. DigitalGuards never receives,
                        transmits, stores, escrows or is able to reconstruct them.
                    </li>
                    <li>
                        <strong>No custody.</strong> DigitalGuards does not at any time hold, safekeep,
                        control or have access to your crypto-assets, private keys, recovery phrases or the
                        means of access to them.
                    </li>
                    <li>
                        <strong>No control over your funds.</strong> DigitalGuards cannot move, freeze,
                        recover, reverse or return your funds, and does not have the technical capability to
                        do so.
                    </li>
                    <li>
                        <strong>Not a crypto-asset service.</strong> DigitalGuards therefore does not provide
                        custody and administration of crypto-assets on behalf of clients, nor any other
                        crypto-asset service within the meaning of Article 3(1)(16) of Regulation (EU)
                        2023/1114 (MiCA), and is not a crypto-asset service provider (CASP).
                    </li>
                    <li>
                        <strong>No trading or intermediation.</strong> DigitalGuards does not offer exchange,
                        swap, trading, execution of orders, reception and transmission of orders, portfolio
                        management, advice, staking or fiat on/off-ramp services through MyQRLWallet, and does
                        not act as an intermediary in any transaction.
                    </li>
                    <li>
                        <strong>No fees.</strong> DigitalGuards charges no fee of any kind for MyQRLWallet.
                        Network fees are paid to the QRL network and are not received by DigitalGuards in
                        whole or in part.
                    </li>
                    <li>
                        <strong>Local signing.</strong> Transactions are constructed and signed locally on
                        your device before they ever reach DigitalGuards infrastructure.
                    </li>
                </ul>
                <p className="mb-4">
                    To let you read public blockchain data and broadcast transactions that you have already
                    signed, MyQRLWallet connects by default to a public RPC endpoint operated by
                    DigitalGuards, and reads certain public chain data from the ZondScan block explorer. That
                    RPC endpoint is a passive relay: it forwards a fixed, limited set of read-only queries and
                    already-signed transactions to the QRL network. It cannot sign, and it does not construct,
                    modify, batch, order, coordinate or mix your transactions. It processes technical
                    connection data (such as your IP address) only as described in our{" "}
                    <Link className={linkClass} to={ROUTES.PRIVACY}>
                        Privacy Policy
                    </Link>
                    .
                </p>
                <p className="mb-6">
                    The QRL network is a public, permissionless and decentralised network that is not owned,
                    controlled or operated by DigitalGuards. We cannot guarantee that any transaction you
                    broadcast will be included, and once broadcast a transaction is irreversible.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">3. Open source licence and trademarks</h2>
                <ul className="list-disc list-inside mb-4">
                    <li>
                        MyQRLWallet is free and open-source software, licensed under the MIT License. The MIT
                        License, and not these Terms, governs your rights to use, modify and redistribute the
                        source code. A copy of the licence is included in each of our public repositories.
                    </li>
                    <li>
                        The software is supplied free of charge. To the extent that DigitalGuards processes
                        any personal data in connection with the software, it does so exclusively for the
                        purpose of improving the security, compatibility or interoperability of the software,
                        and not for any commercial purpose. See the{" "}
                        <Link className={linkClass} to={ROUTES.PRIVACY}>
                            Privacy Policy
                        </Link>{" "}
                        for details.
                    </li>
                    <li>
                        <strong>Trademarks are reserved.</strong> The MIT License covers the source code only.
                        The names and logos "MyQRLWallet" and "DigitalGuards" are not licensed to you. You may
                        not use them in a way that suggests DigitalGuards endorses, is affiliated with or is
                        responsible for a modified or third-party version of the software, and you may not use
                        them to pass off a fork as the official MyQRLWallet. This protects users against
                        phishing and impersonation.
                    </li>
                </ul>
                <p className="mb-6">
                    Contributions to the source code are addressed in section 8 (Contributions).
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">4. Eligibility and acceptable use</h2>
                <p className="mb-4">
                    You represent that you have the legal capacity to enter into these Terms. If you use
                    MyQRLWallet on behalf of an organisation, you represent that you are authorised to bind
                    that organisation. When using MyQRLWallet you agree that you will not:
                </p>
                <ul className="list-disc list-inside mb-4">
                    <li>use the software in violation of any applicable law or regulation;</li>
                    <li>
                        use the software to facilitate money laundering, terrorist financing, fraud or any
                        other illegal activity;
                    </li>
                    <li>
                        interfere with, disrupt, overburden or impair the software or the infrastructure that
                        supports it, including the DigitalGuards RPC endpoint and dApp relay;
                    </li>
                    <li>
                        attempt to circumvent the security controls, method allow-lists or rate limits of that
                        infrastructure; or
                    </li>
                    <li>use the software in breach of the sanctions restrictions in section 5.</li>
                </ul>
                <p className="mb-6">
                    Because MyQRLWallet is open-source software, you are free to build, run and integrate your
                    own applications with it in accordance with the MIT License. No prior permission from
                    DigitalGuards is required to do so.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">5. Sanctions and restricted jurisdictions</h2>
                <p className="mb-4">
                    DigitalGuards is established in the European Union and is bound by EU sanctions law. By
                    using MyQRLWallet you represent and warrant that you are not located in, ordinarily
                    resident in, or acting on behalf of any person or entity located in or ordinarily resident
                    in Cuba, Iran, North Korea, Syria, Russia, Belarus, or the non-government-controlled areas
                    of Ukraine (including Crimea, Donetsk, Luhansk, Kherson and Zaporizhzhia).
                </p>
                <p className="mb-4">
                    You further represent and warrant that you are not, and are not owned or controlled by, a
                    person or entity that is the subject of the EU consolidated sanctions list, the OFAC
                    Specially Designated Nationals (SDN) list, the UK sanctions list or any United Nations
                    sanctions list.
                </p>
                <p className="mb-6">
                    Use of MyQRLWallet by any such person or entity is prohibited. DigitalGuards may restrict
                    access, including by geographic blocking, and reserves the right to do so.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">6. Assumption of risk</h2>
                <p className="mb-4">
                    You are solely responsible for the security of your device, your recovery phrase and your
                    private keys. You acknowledge and accept that:
                </p>
                <ul className="list-disc list-inside mb-6">
                    <li>
                        if you lose your recovery phrase or private keys, or forget the PIN or password that
                        encrypts them on your device, no one, including DigitalGuards, can recover them or your
                        funds;
                    </li>
                    <li>
                        blockchain transactions are irreversible once broadcast, and transactions sent to an
                        incorrect or mistyped address cannot be reversed;
                    </li>
                    <li>
                        the QRL network and any third-party protocols, contracts or tokens you interact with
                        may fail, fork, be reset, contain bugs or behave in unexpected ways, outside the
                        control of DigitalGuards; and
                    </li>
                    <li>
                        phishing, malware and social engineering are real threats; always verify that you are
                        using the official MyQRLWallet.
                    </li>
                </ul>

                <h2 className="text-2xl font-semibold mt-6 mb-3">7. Liability</h2>
                <p className="mb-4">
                    <strong>7.1 Mandatory liability.</strong> Nothing in these Terms limits or excludes any
                    liability that cannot be limited or excluded under applicable mandatory law. In
                    particular, nothing in these Terms limits or excludes liability for death or personal
                    injury caused by our negligence, for intent (opzet) or conscious recklessness (bewuste
                    roekeloosheid), for liability under Directive 85/374/EEC (product liability), or for any
                    other liability that may not be limited or excluded under mandatory law, including
                    mandatory consumer protection law.
                </p>
                <p className="mb-4">
                    <strong>7.2 Exclusion.</strong> Subject to section 7.1, and to the fullest extent
                    permitted by applicable law, DigitalGuards excludes all liability arising out of or in
                    connection with the software and these Terms.
                </p>
                <p className="mb-4">
                    <strong>7.3 Cap.</strong> Subject to section 7.1, and to the fullest extent permitted by
                    applicable law, the total aggregate liability of DigitalGuards arising out of or in
                    connection with the software and these Terms is limited to one hundred euro (EUR 100).
                </p>
                <p className="mb-4">
                    <strong>7.4 Specific exclusions.</strong> Subject to section 7.1, DigitalGuards is not
                    liable for: indirect or consequential loss; loss of profit, data or opportunity; loss of
                    your recovery phrase, private keys, PIN or password; transactions sent to an incorrect or
                    mistyped address; phishing, malware or other compromise of your device or environment; the
                    behaviour, availability, forks, resets, downtime or failures of the QRL network or of any
                    third-party protocol, contract, token or service; or your use of third-party services.
                </p>
                <p className="mb-6">
                    <strong>7.5 Free software.</strong> MyQRLWallet is supplied free of charge under a free
                    and open-source licence. This is relevant to the standard of care that may reasonably be
                    expected of DigitalGuards.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">8. Contributions</h2>
                <p className="mb-6">
                    Contributions to the MyQRLWallet source repositories are governed by the licence of the
                    relevant repository and by any CONTRIBUTING guidelines or Developer Certificate of Origin
                    published with it. DigitalGuards claims no ownership of the ideas in your contributions and
                    does not require, and does not purport to obtain, any waiver of your moral rights.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">9. Testnet</h2>
                <p className="mb-6">
                    QRL 2.0 is currently a public testnet. Testnet tokens have no monetary value, the network
                    may be reset or discontinued, and balances and transaction history may be lost at any time
                    without notice. Do not treat testnet assets as valuable. These Terms will be revised when
                    the QRL 2.0 mainnet launches.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">10. Security updates and support</h2>
                <p className="mb-6">
                    DigitalGuards intends to provide security updates for each released version of MyQRLWallet
                    for a support period of five (5) years from the date of that release, in line with our
                    obligations under Regulation (EU) 2024/2847 (the Cyber Resilience Act). Security issues can
                    be reported as described in our{" "}
                    <Link className={linkClass} to={ROUTES.SECURITY}>
                        Security and Vulnerability Disclosure Policy
                    </Link>
                    .
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">11. Changes to these Terms</h2>
                <p className="mb-6">
                    We may update these Terms from time to time, for example to reflect changes in the software
                    or in the law. We will post the amended Terms with a new "Last updated" date and, where the
                    changes are material, we will provide reasonable notice through the software or our
                    official channels. Changes apply prospectively. Because the software is free, if you do not
                    agree to the amended Terms you can simply stop using MyQRLWallet.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">12. Governing law and forum</h2>
                <p className="mb-4">
                    These Terms are governed by the laws of the Netherlands. The competent court is the
                    Rechtbank Overijssel.
                </p>
                <p className="mb-6">
                    Nothing in this section deprives you, if you are a consumer, of the protection afforded to
                    you by provisions that cannot be derogated from by agreement under the law of the country
                    in which you are habitually resident (Article 6(2) of Regulation (EC) No 593/2008, Rome I),
                    or of your right to bring or defend proceedings in the courts of your place of domicile
                    (Articles 17 to 19 of Regulation (EU) No 1215/2012, Brussels I bis).
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">13. Indemnity (business users only)</h2>
                <p className="mb-6">
                    This section applies only if you use MyQRLWallet in the course of a trade, business, craft
                    or profession, and does not apply to consumers. To the fullest extent permitted by
                    applicable law, you will indemnify DigitalGuards against third-party claims, losses and
                    reasonable costs arising out of your breach of these Terms or your unlawful use of the
                    software.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">14. Third-party services</h2>
                <p className="mb-6">
                    MyQRLWallet may link to, or interoperate with, third-party services such as block
                    explorers, decentralised applications and token contracts. We do not control and are not
                    responsible for those services, and your use of them is at your own risk and subject to
                    their own terms and privacy policies.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">15. General</h2>
                <p className="mb-4">
                    These Terms, together with the{" "}
                    <Link className={linkClass} to={ROUTES.PRIVACY}>
                        Privacy Policy
                    </Link>{" "}
                    and the applicable open-source licence, form the entire agreement between you and
                    DigitalGuards regarding the software. If any provision of these Terms is held to be invalid
                    or unenforceable, the remaining provisions remain in full force and effect. Our failure to
                    enforce any provision is not a waiver of it. You may not assign these Terms without our
                    consent; we may assign them to a successor to our business, provided your rights are not
                    reduced. The{" "}
                    <Link className={linkClass} to={ROUTES.DISCLAIMER}>
                        Disclaimer
                    </Link>{" "}
                    is a plain-language summary for convenience; in case of any conflict, these Terms control.
                </p>
            </main>
        </div>
    );
};

export default Terms;
