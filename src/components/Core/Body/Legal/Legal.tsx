import { Link } from "react-router-dom";
import { SEO } from "@/components/SEO/SEO";
import { ROUTES } from "@/router/router";

const linkClass =
    "text-identity-accent underline underline-offset-2 hover:text-identity-accent/80 transition-colors";

const Legal = () => {
    return (
        <div className="min-h-screen">
            <SEO
                title="Imprint"
                description="Imprint and legal identification for MyQRLWallet, provided by DigitalGuards (eenmanszaak, Netherlands)."
            />
            <main className="container mx-auto max-w-3xl px-4 py-8">
                <h1 className="text-3xl font-bold mb-4">Imprint</h1>

                <p className="mb-2 text-sm text-muted-foreground">Last updated: 13 July 2026</p>

                <p className="mb-6">
                    This imprint is provided in accordance with Article 3:15d of the Dutch Civil Code. MyQRLWallet
                    is a product name. The service provider and contracting party is DigitalGuards.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Service provider</h2>
                <ul className="list-none mb-6 space-y-1">
                    <li><strong>Trade name:</strong> DigitalGuards</li>
                    <li><strong>Legal form:</strong> Eenmanszaak (sole proprietorship), Netherlands</li>
                    <li><strong>Address:</strong> Oude Boekeloseweg 31, 7553 DS Hengelo, Netherlands</li>
                    <li><strong>Chamber of Commerce (KvK) number:</strong> 91987482</li>
                    <li><strong>Vestigingsnummer:</strong> 000057637466</li>
                </ul>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Contact</h2>
                <ul className="list-none mb-6 space-y-1">
                    <li><strong>General:</strong> info@digitalguards.nl</li>
                    <li><strong>Security and privacy:</strong> security@digitalguards.nl</li>
                    <li><strong>Website:</strong> https://digitalguards.nl</li>
                </ul>

                <h2 className="text-2xl font-semibold mt-6 mb-3">VAT</h2>
                <p className="mb-6">
                    DigitalGuards is not registered for VAT (BTW) for this activity, and therefore no VAT
                    identification number is stated.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Nature of the product</h2>
                <p className="mb-6">
                    MyQRLWallet is free, open-source, self-custody client software licensed under the MIT
                    License. DigitalGuards does not provide custody of crypto-assets or any crypto-asset
                    service within the meaning of Regulation (EU) 2023/1114 (MiCA), and charges no fee. See the{" "}
                    <Link className={linkClass} to={ROUTES.TERMS}>
                        Terms of Use
                    </Link>{" "}
                    for the full description.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Related documents</h2>
                <ul className="list-disc list-inside mb-6">
                    <li>
                        <Link className={linkClass} to={ROUTES.TERMS}>
                            Terms of Use
                        </Link>
                    </li>
                    <li>
                        <Link className={linkClass} to={ROUTES.PRIVACY}>
                            Privacy Policy
                        </Link>
                    </li>
                    <li>
                        <Link className={linkClass} to={ROUTES.DISCLAIMER}>
                            Disclaimer
                        </Link>
                    </li>
                    <li>
                        <Link className={linkClass} to={ROUTES.SECURITY}>
                            Security and Vulnerability Disclosure Policy
                        </Link>
                    </li>
                </ul>
            </main>
        </div>
    );
};

export default Legal;
