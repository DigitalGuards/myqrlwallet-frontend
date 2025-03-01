import { ComponentType, Suspense } from "react";
import { Loading } from "@/components/UI/Loading";

const withSuspense = <P extends object>(
  Component: ComponentType<P>,
  customFallback?: React.ReactNode,
) => {
  return (props: P) => (
    <Suspense fallback={customFallback || <Loading />}>
      <Component {...props} />
    </Suspense>
  );
};

export default withSuspense;
