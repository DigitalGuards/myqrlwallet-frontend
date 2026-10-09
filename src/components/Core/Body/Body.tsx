import { Outlet } from "react-router";

const Body = () => {
  return (
    <div className="mx-auto w-full max-w-screen-xl md:min-h-[calc(100vh-16rem)] overflow-visible">
      <Outlet />
    </div>
  );
};

export default Body;
