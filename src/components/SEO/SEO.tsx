import { Helmet } from 'react-helmet-async';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  type?: string;
  author?: string;
  url?: string;
  image?: string;
}

const SITE_NAME = "MyQRLWallet";
const DEFAULT_IMAGE = "https://qrlwallet.com/mqrlwallet.png";

export const SEO = ({
  title = "MyQRLWallet - QRL Web Wallet",
  description = "Web wallet for the QRL Zond blockchain. Create accounts and manage transactions on the quantum resistant ledger.",
  keywords = "QRL, Quantum Resistant Ledger, Zond, Web3, Cryptocurrency Wallet, Blockchain",
  type = "website",
  author = "DigitalGuards",
  url = "https://qrlwallet.com",
  image = DEFAULT_IMAGE,
}: SEOProps) => {
  const fullTitle = title === "MyQRLWallet - QRL Web Wallet" ? title : `${title} | ${SITE_NAME}`;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <meta name="author" content={author} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:site_name" content={SITE_NAME} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  );
};
