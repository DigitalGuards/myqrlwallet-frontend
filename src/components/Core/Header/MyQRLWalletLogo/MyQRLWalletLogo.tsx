import { ROUTES } from "../../../../router/router";
import { Link } from "react-router";
import { QrlMark } from "./QrlMark";

interface MyQRLWalletLogoProps {
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const MyQRLWalletLogo = ({ showText = true, size = 'md' }: MyQRLWalletLogoProps) => {
  const markSizes = {
    sm: 'h-5 w-5',
    md: 'h-8 w-8',
    lg: 'h-10 w-10'
  };
  const textSizes = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-xl'
  };

  return (
    <Link to={ROUTES.HOME} aria-label="MyQRLWallet home">
      <span className="flex items-center gap-2">
        <QrlMark className={`${markSizes[size]} text-primary`} />
        {showText && (
          <span className={`${textSizes[size]} font-display font-semibold tracking-tight text-foreground`}>
            MyQRLWallet
          </span>
        )}
      </span>
    </Link>
  );
};

export default MyQRLWalletLogo;
