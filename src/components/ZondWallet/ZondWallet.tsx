import RouteMonitor from "./RouteMonitor/RouteMonitor";
import withSuspense from "../../functions/withSuspense";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { Toaster } from "@/components/UI/toaster"

const Header = withSuspense(
  lazy(() => import("./Header/Header"))
);
const Body = withSuspense(
  lazy(() => import("./Body/Body"))
);

const ZondWallet = observer(() => {
  return (
    <div className="bg-background text-foreground scroll-auto">
      
      <RouteMonitor />
      <Header />
      <main className="mt-16">
        <Body />
      </main>
      <Toaster />
    </div>
  );
});

export default ZondWallet;
