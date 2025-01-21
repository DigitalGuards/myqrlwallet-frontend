import { Helmet } from 'react-helmet-async';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  type?: string;
  name?: string;
  url?: string;
}

export const SEO = ({
  title = "QRL Zond Web3 Wallet",
  description = "A community-driven web wallet for QRL's Zond blockchain. Create accounts, manage transactions, and interact with the quantum-resistant ledger ecosystem.",
  keywords = "QRL, Quantum Resistant Ledger, Zond, Web3, Cryptocurrency Wallet, Blockchain, Quantum Computing, Community Wallet",
  type = "website",
  name = "DigitalGuards QRL Zond Wallet Project",
  url = "https://qrlwallet.com",
}: SEOProps) => {
  const siteTitle = title === "QRL Zond Web3 Wallet" ? title : `${title} | QRL Zond Web3 Wallet`;

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
