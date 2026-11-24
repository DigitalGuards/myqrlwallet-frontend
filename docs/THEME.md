# Theme

Every build offers the Theme row (Settings, Preferences): Dark, Light, System. There is no build flag. A leftover `VITE_ENABLE_LIGHT_THEME` in an environment or `.env` is ignored by every build; the embedded build names it as a retired variable and still rejects every other unknown `VITE_` variable.

## Values

- `DEFAULT_THEME` in `src/theme/values.ts` is the single default (`system`: follow the device's light or dark setting through `prefers-color-scheme`, live). Nothing writes it to storage, so changing it reaches every user who has not chosen. The Theme row shows System for them.
- The user's choice is stored under `THEME_STORAGE_KEY` (browser and desktop renderer). A missing, unreadable or unknown value means the default.
- The page is light when `<html data-theme="light">` is set. Dark carries no attribute.

## First frame

`config/vite.config.ts` emits `assets/theme-boot-<hash>.js` and links it as a classic script in `<head>`. It sets the attribute and the `theme-color` meta before the first paint. The file is same-origin, so every `script-src 'self'` policy allows it and no inline-script hash changes. The embedded build has no origin and inlines the phone variant instead; its policy hash is added with the other inline scripts. `src/theme/bootScript.ts` generates both, and `bootScript.test.ts` checks them against the module over one matrix.

## Shells

A shell that leads the theme plugs in through `ShellThemeAdapter` in `src/theme/shell.ts`. With an adapter the wallet applies the shell's `resolved` value and never reads `prefers-color-scheme`.

Phone app (embedded build, or `isInNativeApp()`):

- Before the document runs the shell injects `window.__QRL_SHELL_THEME__ = { theme, resolved }`.
- `SET_THEME` (shell to wallet) carries `{ theme, resolved }`. Both fields must validate or the message is ignored. The last valid state is cached under `WALLET_SHELL_THEME`, which is a copy of the shell's state and never the user's choice.
- `THEME_CHANGED` (wallet to shell) carries `{ theme }` when the user uses the wallet's own Theme row.
- Both messages use the existing bridge envelope and document binding.
- With no injected value and no cache the wallet shows dark (`SHELL_FALLBACK_RESOLVED`) while the Theme row shows the default, System. The system setting is not consulted in a shell; the shell normally states its value before the first frame, so this is a fixed colour for the rare document that got none. The same fallback applies in `currentThemeState` and the phone boot script.

Desktop app (the main process leads), all members optional on `window.qrlWallet`:

- `theme`: `{ theme, resolved }`, a plain value present before the first script runs. When it is valid the main process is the source of truth: the wallet applies `resolved`, shows `theme` in the Theme row and does not use its stored choice or `prefers-color-scheme`. Nothing is cached.
- `setTheme(theme)`: the wallet's Theme row sends the choice, and the row shows it at once.
- `onThemeChanged(callback)`: the main process pushes `{ theme, resolved }`. The state is validated like `SET_THEME`. The wallet unsubscribes when the theme module stops.
- Without `theme` the renderer keeps the browser behaviour.
