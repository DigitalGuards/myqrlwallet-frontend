import { withSuspense } from "@/utils/react";
import { useStore } from "../../../stores/store";
import { observer } from "mobx-react-lite";
import { lazy } from "react";

const ZondWalletLogo = withSuspense(
  lazy(() => import("./ZondWalletLogo/ZondWalletLogo"))
);
const AccountBadge = withSuspense(
  lazy(() => import("./AccountBadge/AccountBadge"))
);
const NavBar = withSuspense(
  lazy(() => import("./NavBar/NavBar"))
)

const Header = observer(() => {
  const { zondStore } = useStore();
  const { zondConnection } = zondStore;
  const { isConnected } = zondConnection;

  return (
    <header
      className="sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b-2 bg-background px-4 shadow-sm"
      style={{ borderBottomColor: 'hsl(25, 95%, 53%)' }}
    >
      <ZondWalletLogo />
      <div className="flex flex-row-reverse md:flex-row gap-0 md:gap-4 items-center">
        <NavBar />
        {isConnected && <AccountBadge />}
      </div>
    </header>
  );
});

export default Header;
