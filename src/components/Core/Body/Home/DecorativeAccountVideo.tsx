import { useEffect, useRef, useState } from "react";
import { subscribeToNativeMessages } from "@/utils/nativeApp";

/** Silent decoration with a static fallback when motion or playback is unavailable. */
export default function DecorativeAccountVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let nativeActive = true;
    let nativeState: string | undefined;
    let visible = !document.hidden;
    let playbackStarted = false;
    let generation = 0;
    let attempts = 0;
    let pending = false;
    let burstActive = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const eligible = () =>
      !disposed && nativeActive && !document.hidden && !motion.matches;
    const clearTimers = () => {
      clearTimeout(retryTimer);
      clearTimeout(deadlineTimer);
      retryTimer = undefined;
      deadlineTimer = undefined;
    };
    const stop = () => {
      generation += 1;
      burstActive = false;
      pending = false;
      playbackStarted = false;
      clearTimers();
      video.pause();
      if (!disposed) setPlaying(false);
    };
    const attempt = () => {
      if (
        !eligible() ||
        !burstActive ||
        pending ||
        !video.paused ||
        attempts >= 3
      )
        return;
      clearTimeout(retryTimer);
      attempts += 1;
      pending = true;
      const owner = generation;
      // Reassert silence before every attempt, including foreground recovery.
      video.muted = true;
      video.defaultMuted = true;
      const failed = () => {
        if (disposed || owner !== generation || !burstActive) return;
        pending = false;
        setPlaying(false);
        if (eligible() && attempts < 3) retryTimer = setTimeout(attempt, 350);
        else stop();
      };
      try {
        void video.play().then(() => {
          if (disposed || owner !== generation) {
            if (disposed || (!burstActive && !playbackStarted)) video.pause();
            return;
          }
          pending = false;
          // The playing event reveals the video only after playback really starts.
        }, failed);
      } catch {
        failed();
      }
    };
    const start = () => {
      if (!eligible()) {
        stop();
        return;
      }
      if (burstActive || !video.paused) return;
      generation += 1;
      attempts = 0;
      burstActive = true;
      // A stalled play promise cannot leave retries or a native overlay running.
      deadlineTimer = setTimeout(stop, 4000);
      // Let effect cleanup cancel an abandoned mount before touching media.
      retryTimer = setTimeout(attempt, 0);
    };
    const onPlaying = () => {
      if (!eligible() || (!burstActive && !playbackStarted)) {
        stop();
        return;
      }
      burstActive = false;
      pending = false;
      playbackStarted = true;
      clearTimers();
      setPlaying(true);
    };
    const onPause = () => {
      playbackStarted = false;
      setPlaying(false);
    };
    const onVisibility = () => {
      const nextVisible = !document.hidden;
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (visible) start();
      else stop();
    };
    const onMotion = () => (motion.matches ? stop() : start());
    const unsubscribe = subscribeToNativeMessages((message) => {
      if (message.type === "APP_STATE") {
        const state = message.payload?.["state"];
        if (state === nativeState) return;
        if (state === "active") {
          nativeState = state;
          nativeActive = true;
          start();
        } else if (state === "inactive" || state === "background") {
          nativeState = state;
          nativeActive = false;
          stop();
        }
      } else if (message.type === "UNLOCK_WITH_PIN") {
        // Only the lifecycle signal is relevant. No credential is read or retained.
        start();
      }
    });
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("error", stop);
    video.addEventListener("canplay", attempt);
    video.addEventListener("loadeddata", attempt);
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onMotion);
    start();
    return () => {
      disposed = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("error", stop);
      video.removeEventListener("canplay", attempt);
      video.removeEventListener("loadeddata", attempt);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      unsubscribe();
      stop();
    };
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <img
        src="/tree.svg"
        alt=""
        className="h-full w-full object-cover opacity-10"
      />
      <div className="absolute inset-0" style={{ opacity: playing ? 1 : 0 }}>
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          preload="none"
          disableRemotePlayback
          tabIndex={-1}
          className="decorative-video h-full w-full object-cover opacity-30"
        >
          <source src="/qrl-video-dark.mp4" type="video/mp4" />
        </video>
      </div>
    </div>
  );
}
