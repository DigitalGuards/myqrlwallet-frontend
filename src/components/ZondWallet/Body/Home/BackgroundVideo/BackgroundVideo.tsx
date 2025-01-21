import { useStore } from "../../../../../stores/store";
import { cva } from "class-variance-authority";
import { observer } from "mobx-react-lite";

const backgroundVideoClasses = cva(
  "absolute inset-0 w-full h-full object-cover z-0 opacity-35",
  {
    variants: {
      isDarkMode: {
        true: [],
        false: [],
      },
    },
    defaultVariants: {
      isDarkMode: false,
    },
  }
);

const videoContainerClasses = cva(
  "absolute inset-0 w-full h-full overflow-hidden", 
  {
    variants: {
      isDarkMode: {
        true: ["after:content-[''] after:absolute after:inset-0 after:bg-black/20"],
        false: [],
      },
    },
    defaultVariants: {
      isDarkMode: false,
    },
  }
);

const BackgroundVideo = observer(() => {
  const { settingsStore } = useStore();
  const { isDarkMode, theme } = settingsStore;

  const backgroundVideoSource = `/qrl-video-${theme}.mp4`;

  return (
    <div className={videoContainerClasses({ isDarkMode })}>
      <video
        autoPlay
        muted
        loop
        style={{ 
          objectPosition: '5% 35%'
        }}
        className={backgroundVideoClasses({ isDarkMode })}
      >
        <source src={backgroundVideoSource} type="video/mp4" />
      </video>
    </div>
  );
});

export default BackgroundVideo;
