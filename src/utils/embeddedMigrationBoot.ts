/**
 * Runs the hosted-to-embedded migration at module-evaluation time.
 *
 * This exists as its own module so the work happens while the import graph is
 * still being evaluated. `main.tsx` imports it above `./App.tsx`, and
 * evaluating `./App.tsx` constructs the MobX stores, whose DAppConnectStore
 * constructor reads the persisted dApp sessions and starts reconnecting. A
 * call placed in `main.tsx`'s body would run after every import had already
 * been evaluated, which is too late.
 *
 * The call is wrapped because it runs at module-evaluation time in a bundle
 * with no code splitting: a throw here aborts evaluation of the single chunk,
 * so `main.tsx` never reaches `ReactDOM.createRoot` and the user gets a blank
 * document. The embedded build cannot reload out of that state, and an app
 * restart re-runs the same code with the same flag still set, so it would
 * reproduce on every launch. Migration is a cleanup; failing it must never
 * cost the user their wallet.
 *
 * Keep this module's import graph free of anything reaching
 * `src/stores/store.ts`.
 */
import { runEmbeddedMigration } from "./embeddedMigration";

try {
  runEmbeddedMigration();
} catch (error) {
  // `runEmbeddedMigration` already reports its own failures and does not tell
  // the app it finished, so the app retries on the next launch. Anything that
  // still escapes lands here and the wallet boots regardless.
  console.error("[embedded] migration threw, continuing boot", error);
}
