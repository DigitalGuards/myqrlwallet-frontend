import { SEO } from "@/components/SEO/SEO";

const Privacy = () => {
    return (
        <div className="min-h-screen">
            <SEO
                title="Privacy Policy"
                description="Privacy policy for the QRL Zond Web3 Wallet"
            />
            <main className="container mx-auto px-4 py-8">
                <div>
                    <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>

                    <p className="mb-4">
                        Please read through this Privacy Policy carefully as it may affect your rights and it also helps you understand how much we value the privacy of your data.
                    </p>

                    <p className="mb-6">
                        <strong>Last Updated: 14 March 2025</strong>
                    </p>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">1. Introduction</h2>

                    <p className="mb-6">
                        This Privacy Policy explains how information and data about you is collected, used, and disclosed by Zond Wallet and its group companies ("we" or "us"). This Privacy Policy (together with our Terms of Service and any other documents referred to in this document or the Terms of Service) applies to information we collect when you use our websites, mobile applications, hosted wallet accounts, and other online products and services (collectively, the "Services") or when you otherwise interact with us.
                    </p>

                    <p className="mb-6">
                        We may change this Privacy Policy from time to time. If we make changes, we will notify you by changing the "Last Updated" date at the top of this page and, in some cases, we may provide you with additional notice by adding a statement to our blog page on Medium, social media accounts, or sending you push notifications on your device. Unfortunately, because we don't store your details (see below for exactly what we do and don't store), we can't notify you of any changes via email. Therefore, we encourage you to review the Privacy Policy whenever you access the Services to stay informed about our information practices and the ways you can join us in protecting your privacy.
                    </p>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">2. Collection of Information</h2>

                    <h3 className="text-xl font-semibold mt-4 mb-2">Information You Provide to Us</h3>

                    <p className="mb-6">
                        We collect information you provide directly to us. When opening a wallet, you'll notice that you will provide literally no information directly to us. This usually relates to communications between you and our support teams or for any once-off interactive features (in these circumstances, we will usually explain exactly how that information will be used, so don't worry).
                    </p>

                    <h3 className="text-xl font-semibold mt-4 mb-2">Information We Collect Automatically When You Use the Services</h3>

                    <p className="mb-4">
                        When you access or use our Services, we automatically collect information about you, including:
                    </p>

                    <ul className="list-disc list-inside mb-6">
                        <li><strong>Your Wallet's Public Address and View Key</strong>: Your private key, mnemonic seed, and all the crucial wallet information are yours to protect, and we will never have access to them.</li>
                        <li><strong>The Last Date Your Wallet Was Accessed</strong></li>
                        <li><strong>The Subdomain of the API from Which the Services Are Accessed</strong> (where access is made via an API)</li>
                        <li><strong>Error Information</strong>: When an error occurs, we collect information about the error (such as the date and error type) and log information about the type of device, browser, and operating system you were using at the time of the error in the form of your user agent. In circumstances in which there isn't an error, this information will not be collected.</li>
                    </ul>

                    <h3 className="text-xl font-semibold mt-4 mb-2">Information We Do Not Collect</h3>

                    <p className="mb-6">
                        Because we care about your privacy, there is some information which we have deliberately designed our systems not to collect, including:
                    </p>

                    <ul className="list-disc list-inside mb-6">
                        <li><strong>IP Address</strong>: We do not actively track or collect the IP address from which you access the Services— that's your business.</li>
                        <li><strong>Log Information</strong>: Information about your use of the Services, including the type of browser you use, access times, pages viewed, pages you visited before navigating to our websites, etc. As stated above, some of this information such as the type of browser or operating system you're using will be logged but only in circumstances in which an error occurs.</li>
                        <li><strong>Device Information</strong>: Information about the mobile device you use to access our mobile application, including the hardware model, operating system and version, unique device identifiers, and mobile network information. Again, when an error occurs, we log the type of device and operating system but in normal, error-free use, our system won't log any of it.</li>
                        <li><strong>Information Collected by Cookies and Other Tracking Technologies</strong>: Cookies are small data files stored on your hard drive or in device memory that are used to track your usage of websites and other online tools often for purposes of monitoring and maintenance, but we don't use them. Regardless, you are always welcome to disable the use of cookies on your browser to make absolutely certain there isn't anyone watching.</li>
                        <li><strong>Account Address Information</strong>: All we store is your public address and view key; we will never store or know your private spend key or mnemonic seed, which means that it is cryptographically impossible for us to spend funds on your behalf or access your wallet.</li>
                    </ul>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">3. Use of Information</h2>

                    <p className="mb-6">
                        We may use the little information we collect for various purposes, including to:
                    </p>

                    <ul className="list-disc list-inside mb-6">
                        <li>Provide, maintain, and improve our Services.</li>
                        <li>Provide and deliver the services you specifically request and send you related information regarding those requests.</li>
                        <li>Respond to your comments, questions, and requests and provide customer service.</li>
                        <li>Monitor and analyze trends, usage, and activities in connection with our Services in an aggregate and anonymous manner.</li>
                        <li>Process and deliver contest entries, rewards, or results through specifically designed interactive features.</li>
                        <li>Carry out any other purpose for which you provided the information (such purposes will be explained wherever we need to collect any new information not outlined above).</li>
                    </ul>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">4. Sharing of Information</h2>

                    <p className="mb-6">
                        We may share the little information collected about you in the following ways:
                    </p>

                    <ul className="list-disc list-inside mb-6">
                        <li><strong>With the QRL Network</strong>: We will share your public account address and any transaction details to facilitate any transaction request you submit via the Services.</li>
                        <li><strong>With Vendors, Consultants, and Other Service Providers</strong>: They may need access to such information to carry out work on our behalf. It is our standard practice to require all of our vendors and contractors to handle your information in accordance with this Privacy Policy and that they would not be provided any additional information other than the information outlined above. Furthermore, access to our databases is severely restricted even within the company, so third-party service providers will almost never be given access to the public addresses and view keys we store.</li>
                        <li><strong>Legal Obligations</strong>: In response to an official request for information by a regulator or body with legitimate jurisdiction, provided that we are satisfied that the disclosure is required by any applicable law, regulation, or legal process.</li>
                        <li><strong>Protecting Rights</strong>: If we believe your actions are inconsistent with the spirit or language of our user agreements or policies, or to protect the rights, property, and safety of us or others.</li>
                        <li><strong>Business Transfers</strong>: In connection with, or during negotiations of, any merger, sale of our assets, financing, or acquisition of all or a portion of our business to another company. As with our vendors and contractors, we will ensure that this information is protected in accordance with this Privacy Policy and that no additional information is collected for these purposes without amendment to this Privacy Policy. Note that we keep our database of public addresses and view keys only for the proper operation of the Services and do not consider them an asset of ours to sell. Because of this, we will ensure that any prospective merger partner or acquirer of our Services will be restricted from accessing these databases until such a time and in such a manner in which such access is necessary for the continued operation of the Services.</li>
                        <li><strong>With Your Consent</strong>: Or at your direction, including if we notify you through our Services that the information you provide will be shared in a particular manner and you provide such information.</li>
                        <li><strong>Aggregated or De-identified Information</strong>: As far as possible, any information we share will be aggregated or de-identified information which cannot reasonably be used to identify you.</li>
                    </ul>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">5. Security</h2>

                    <p className="mb-6">
                        As users of our own Services, we take its security very seriously and ensure that we apply reasonable measures to help protect information about you from loss, theft, misuse, unauthorized access, disclosure, alteration, and destruction. However, as we do not collect the most important information about you and your use of the Services, the security of your information is also in your hands, and we recommend that you take this as seriously as we do.
                    </p>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">6. Your Rights in Relation to Your Information</h2>

                    <p className="mb-6">
                        Whether you know it or not, you have the following rights in relation to your information that we collect:
                    </p>

                    <ul className="list-disc list-inside mb-6">
                        <li><strong>Right to Access</strong>: You have the right to request copies of the information we hold about you at any time. If we provide you with access to the information we hold about you, we will not charge you unless your request is "manifestly unfounded or excessive." Where we are legally permitted to do so, we may refuse your request, and if we do so, we will tell you the reasons for such refusal.</li>
                        <li><strong>Right to Correct</strong>: You have the right to have your information rectified where it is inaccurate or incomplete.</li>
                        <li><strong>Right to Erase</strong>: You have the right to request that we delete or remove your information from our systems.</li>
                        <li><strong>Right to Restrict Our Use of Your Information</strong>: You have the right to "block" us from using your information or limit the way in which we can use it.</li>
                        <li><strong>Right to Data Portability</strong>: You have the right to request that we move, copy, or transfer your information.</li>
                        <li><strong>Right to Object</strong>: You have the right to object to our use of your information, including where we use it for our legitimate interests.</li>
                    </ul>

                    <p className="mb-6">
                        It is important to remember that, because we collect so little data on you, it will often be difficult to identify which information is yours, which could make the exercise of any of the above rights impossible in the circumstances.
                    </p>

                    <h2 className="text-2xl font-semibold mt-6 mb-3">7. Contact Us</h2>

                    <p className="mb-6">
                        If you have any questions about this Privacy Policy or wish to exercise any of your rights, please <a target="_blank" href="https://github.com/DigitalGuards/" className="text-blue-600 underline">open an issue in our GitHub repository</a>.
                    </p>
                </div>
            </main>
        </div>
    );
};

export default Privacy;
