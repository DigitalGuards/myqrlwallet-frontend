import { Helmet } from 'react-helmet';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  type?: string;
  name?: string;
  url?: string;
}

export const SEO = ({
  title = "MyQRLWallet - QRL Web Wallet",
  description = "Web wallet for the QRL Zond blockchain. Create accounts and manage transactions on the quantum resistant ledger.",
  keywords = "QRL, Quantum Resistant Ledger, Zond, Web3, Cryptocurrency Wallet, Blockchain",
  type = "website",
  name = "DigitalGuards",
  url = "https://qrlwallet.com",
}: SEOProps) => {
  const siteName = "MyQRLWallet - QRL Web Wallet";
  const siteTitle = title === siteName ? siteName : `${title} | ${siteName}`;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{siteTitle}</title>
      <meta name="title" content={siteTitle} />
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <meta name="author" content={name} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={siteTitle} />
      <meta property="og:description" content={description} />

      {/* Twitter */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={url} />
      <meta property="twitter:title" content={siteTitle} />
      <meta property="twitter:description" content={description} />
    </Helmet>
  );
};
