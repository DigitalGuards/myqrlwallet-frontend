import { observer } from "mobx-react-lite";

const BackgroundVideo = observer(() => {
  return (
    <img
      className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
      src="/tree.svg"
      alt="Background Tree"
    />
  );
});

export default BackgroundVideo;
