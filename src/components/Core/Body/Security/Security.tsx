import { PageShell } from "@/components/Core/Layout/PageShell";
import { Card } from "@/components/UI/Card";
import { Link } from "react-router";
import { SEO } from "@/components/SEO/SEO";
import { ROUTES } from "@/router/router";

const linkClass =
    "text-identity-accent underline underline-offset-2 hover:text-identity-accent/80 transition-colors";

// Both files are served by the live site, never by the application bundle.
// Root-relative hrefs resolve against whatever origin the document happens to
// have, which is wrong in the desktop build (file://) and in the app-shipped
// embedded build. Absolute URLs work in the browser and on desktop.
//
// In the app they do not: the native shell refuses to hand the wallet's own
// host to an external browser, so both links did nothing there. The addresses
// are shown as plain text so they can still be read and typed, and the
// repository's security policy, on a host the app does open, carries the same
// contact details.
const SECURITY_TXT_TEXT = "qrlwallet.com/.well-known/security.txt";
const PGP_KEY_TEXT = "qrlwallet.com/pgp-key.txt";
const SECURITY_POLICY_URL =
    "https://github.com/DigitalGuards/myqrlwallet-frontend/security/policy";

const Security = () => {
    return (
        <PageShell title="Security and Vulnerability Disclosure Policy" width="wide">
            <SEO
                title="Security Policy"
                description="Security and coordinated vulnerability disclosure policy for MyQRLWallet by DigitalGuards, including a safe-harbour statement."
            />
            <Card className="p-6">

                <p className="mb-2 text-sm text-muted-foreground">Last updated: 13 July 2026</p>

                <p className="mb-6">
                    DigitalGuards welcomes reports from security researchers. If you believe you have found a
                    security vulnerability in MyQRLWallet, please tell us. This policy explains how to report,
                    what you can expect from us, and the safe harbour we offer for good-faith research.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">How to report</h2>
                <p className="mb-6">
                    Email <strong>security@digitalguards.nl</strong>. Please include enough detail to
                    reproduce the issue: the affected component and version, a description of the impact, and
                    step-by-step reproduction instructions or a proof of concept. Our machine-readable contact
                    details are published at{" "}
                    <span className="font-mono text-sm">{SECURITY_TXT_TEXT}</span>{" "}
                    in line with RFC 9116.
                </p>
                <p className="mb-6">
                    For sensitive reports you can encrypt to our PGP key, published at{" "}
                    <span className="font-mono text-sm">{PGP_KEY_TEXT}</span>{" "}
                    (fingerprint EAE7 9D7C 2805 9C17 4870 13CB BE48 C074 FFF0 495D).
                </p>
                <p className="mb-6">
                    The same contact details are in our{" "}
                    <a
                        className={linkClass}
                        href={SECURITY_POLICY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        repository security policy
                    </a>
                    , which opens in a browser from every version of the wallet.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Scope</h2>
                <p className="mb-4">In scope:</p>
                <ul className="list-disc list-inside mb-4">
                    <li>The MyQRLWallet web wallet (qrlwallet.com) and the site at myqrlwallet.com.</li>
                    <li>The MyQRLWallet desktop application, mobile application and browser extension.</li>
                    <li>The MyQRLWallet source repositories published by DigitalGuards on GitHub.</li>
                    <li>The DigitalGuards RPC proxy and dApp Connect relay used by the wallet.</li>
                    <li>The ZondScan block explorer (zondscan.com).</li>
                </ul>
                <p className="mb-6">
                    Out of scope: third-party services, the QRL network and protocol itself, and issues that
                    require physical access to a victim's unlocked device. Please do not test against other
                    users, and do not run denial-of-service or spam tests.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Safe harbour</h2>
                <p className="mb-6">
                    If you make a good-faith effort to comply with this policy during your research, we will
                    consider your research to be authorised, we will not pursue or support legal action against
                    you for it, and we will work with you to understand and resolve the issue quickly.
                    Good-faith research means: you act only against assets in scope, you avoid privacy
                    violations, data destruction and service degradation, you access only the minimum data
                    necessary to demonstrate the issue, and you give us a reasonable opportunity to fix the
                    issue before disclosing it publicly. If in doubt, ask us first.
                </p>

                <h2 className="text-2xl font-semibold mt-6 mb-3">What to expect from us</h2>
                <ul className="list-disc list-inside mb-6">
                    <li>We will acknowledge your report within 3 business days.</li>
                    <li>We will provide an initial assessment within 10 business days.</li>
                    <li>We will keep you informed of our progress towards a fix.</li>
                    <li>
                        We will credit you for your report if you would like us to, once the issue is
                        resolved.
                    </li>
                </ul>

                <h2 className="text-2xl font-semibold mt-6 mb-3">Coordinated disclosure</h2>
                <p className="mb-6">
                    We ask that you give us a reasonable time to remediate before any public disclosure, and
                    that you coordinate the timing of any disclosure with us. See also our{" "}
                    <Link className={linkClass} to={ROUTES.TERMS}>
                        Terms of Use
                    </Link>{" "}
                    and{" "}
                    <Link className={linkClass} to={ROUTES.PRIVACY}>
                        Privacy Policy
                    </Link>
                    .
                </p>
            </Card>
        </PageShell>
    );
};

export default Security;
