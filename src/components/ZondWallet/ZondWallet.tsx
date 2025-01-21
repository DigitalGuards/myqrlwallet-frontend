import RouteMonitor from "./RouteMonitor/RouteMonitor";
import withSuspense from "../../functions/withSuspense";
import { observer } from "mobx-react-lite";
import { lazy } from "react";

const Header = withSuspense(
  lazy(() => import("./Header/Header"))
);
const Body = withSuspense(
  lazy(() => import("./Body/Body"))
);

const ZondWallet = observer(() => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <RouteMonitor />
      <Header />
      <main className="mt-16">
        <Body />
      </main>
    </div>
  );
});

export default ZondWallet;
