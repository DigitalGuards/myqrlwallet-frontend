/**
 * Build-time guards against publishing the build environment.
 *
 * Vite replaces `import.meta.env.KEY` (dot access) with the literal value of
 * that one key. It cannot do that for a bare `import.meta.env` or any bracket
 * lookup, including a literal `import.meta.env["KEY"]` (verified on this Vite
 * 8 / Rolldown build), so it falls back to inlining the WHOLE
 * environment object: every VITE_ variable present at build time, whether or
 * not the code reads it. The published qrlwallet.com bundle carried all of them
 * that way, including `VITE_SEED`. It was empty, so nothing leaked, but the
 * mechanism is the same one that published a seed from the desktop build.
 *
 * Two checks, because either alone is insufficient:
 *   - a source-level check, which names the file and the construct to fix
 *   - an output-level check, which is what actually decides whether a dangerous
 *     key name reached the artifact, however it got there
 *
 * These are pure so they can be unit tested; `config/vite.config.ts` wires them
 * into a plugin that runs for the web, desktop and embedded builds alike.
 */

/**
 * Environment key names that must never appear in a browser bundle, matched on
 * the name so an empty value is caught too. A variable is public the moment it
 * is inlined; whether it happens to be empty on one build machine is not a
 * property anything should depend on.
 */
export const FORBIDDEN_ENV_KEY_PATTERN =
  /\bVITE_[A-Z0-9_]*(?:SEED|MNEMONIC|PRIVATE|SECRET|PASSWORD|TOKEN|KEY)[A-Z0-9_]*\b/g;

/**
 * `import.meta.env` used as a value in its own right. Anything other than a
 * literal `.KEY` or `["KEY"]` access forces the whole-object inline, including
 * a computed `[key]` lookup and a spread.
 */
const WHOLE_ENV_REFERENCE = /import\s*\.\s*meta\s*\.\s*env\s*(?!\.\s*[A-Za-z_$]|\[\s*["'])/g;

/** Strip comments and string literals so prose about the rule cannot trip it. */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
    .replace(/"(?:\\[\s\S]|[^\\"\n])*"/g, '""')
    .replace(/'(?:\\[\s\S]|[^\\'\n])*'/g, "''");
}

/**
 * Whole-object `import.meta.env` uses in one module's source.
 *
 * Returns the offending snippets; an empty array means every access in this
 * module names its key and Vite will replace it with that value alone.
 */
export function findWholeEnvReferences(code: string): string[] {
  const source = stripCommentsAndStrings(code);
  return [...source.matchAll(WHOLE_ENV_REFERENCE)].map((match) =>
    source.slice(match.index, match.index + 40).trim(),
  );
}

/**
 * Dangerous environment key names present in emitted bundle code.
 *
 * This runs on the generated chunks, so it holds regardless of which module or
 * which dependency caused the inline.
 */
export function findForbiddenEnvKeys(code: string): string[] {
  return [...new Set(code.match(FORBIDDEN_ENV_KEY_PATTERN) ?? [])].sort();
}
