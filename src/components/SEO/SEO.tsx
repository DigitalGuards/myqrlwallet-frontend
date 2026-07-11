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
const DEFAULT_TITLE = "MyQRLWallet: Web Wallet for QRL, the Post-Quantum Blockchain";
const DEFAULT_DESCRIPTION =
  "Free web wallet for QRL 2.0, the post-quantum blockchain. Create quantum-resistant accounts, send QRL, and manage tokens and NFTs securely in your browser.";
const DEFAULT_IMAGE = "https://qrlwallet.com/og-image.png";

export const SEO = ({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  keywords = "QRL, QRL 2.0, Quantum Resistant Ledger, post-quantum blockchain, QRL wallet, web wallet, cryptocurrency wallet",
  type = "website",
  author = "DigitalGuards",
  url = "https://qrlwallet.com/",
  image = DEFAULT_IMAGE,
}: SEOProps) => {
  const fullTitle = title === DEFAULT_TITLE ? title : `${title} | ${SITE_NAME}`;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <meta name="author" content={author} />
      <link rel="canonical" href={url} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:image:alt" content="MyQRLWallet: web wallet for QRL 2.0, the post-quantum blockchain" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="en_US" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@DigitalGuards" />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content="MyQRLWallet: web wallet for QRL 2.0, the post-quantum blockchain" />
    </Helmet>
  );
};
