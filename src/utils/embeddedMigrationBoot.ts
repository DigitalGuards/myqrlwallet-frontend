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
 * Keep this module's import graph free of anything reaching
 * `src/stores/store.ts`.
 */
import { runEmbeddedMigration } from "./embeddedMigration";

runEmbeddedMigration();
