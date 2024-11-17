import { Outlet } from "react-router-dom";

const Body = () => {
  return (
    <div className="mx-auto max-w-screen-xl px-4">
      <Outlet />
    </div>
  );
};

export default Body;
