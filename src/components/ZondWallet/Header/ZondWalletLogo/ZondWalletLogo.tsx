import { ROUTES } from "../../../../router/router";
import { Link } from "react-router-dom";

interface ZondWalletLogoProps {
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const ZondWalletLogo = ({ showText = true, size = 'md' }: ZondWalletLogoProps) => {
  const logoSizes = {
    sm: 'h-5 w-5',
    md: 'h-6 w-6',
    lg: 'h-8 w-8'
  };

  return (
    <Link to={ROUTES.HOME}>
      <span className="flex items-center gap-2">
        <img className={logoSizes[size]} src="/icons/qrl/default.png" alt="QRL Logo" />
        {showText && (
          <div className="flex flex-col text-xs font-bold text-secondary">
            <span className="text-lg">MyQRLwallet</span>
          </div>
        )}
      </span>
    </Link>
  );
};

export default ZondWalletLogo;
