import { ROUTES } from "../../../../router/router";
import { Link } from "react-router-dom";

interface MyQRLWalletLogoProps {
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const MyQRLWalletLogo = ({ showText = true, size = 'md' }: MyQRLWalletLogoProps) => {
  const logoSizes = {
    sm: 'h-5 w-5',
    md: 'h-8 w-8',
    lg: 'h-12 w-12'
  };

  return (
    <Link to={ROUTES.HOME}>
      <span className="flex items-center gap-2">
        <img className={logoSizes[size]} src="/icons/theqrlwallet/192.png" alt="QRL Logo" />
        {showText && (
          <div className="flex flex-col text-xs font-bold text-secondary">
            <span className="text-lg">MyQRLwallet</span>
          </div>
        )}
      </span>
    </Link>
  );
};

export default MyQRLWalletLogo;
