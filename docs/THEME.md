# Theme

Every build offers the Theme row (Settings, Preferences): Dark, Light, System. There is no build flag. A leftover `VITE_ENABLE_LIGHT_THEME` in an environment or `.env` is ignored by every build; the embedded build names it as a retired variable and still rejects every other unknown `VITE_` variable.

## Values

- `DEFAULT_THEME` in `src/theme/values.ts` is the single default (`dark`). Nothing writes it to storage, so changing it reaches every user who has not chosen.
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
