import { Outlet } from "react-router-dom";

const Body = () => {
  return (
    <div className="mx-auto max-w-screen-xl px-2 py-4 min-h-[calc(100vh-16rem)] overflow-visible">
      <Outlet />
    </div>
  );
};

export default Body;
