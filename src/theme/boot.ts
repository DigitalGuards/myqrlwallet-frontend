// Side-effect module: imported near the top of main.tsx so the saved theme is
// applied before React renders, which also covers the boot-failure screens.
import { initTheme } from "./preference";

initTheme();
