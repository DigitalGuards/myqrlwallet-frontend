/**
 * Profanity filter for user-chosen, on-chain-visible text such as token
 * names and symbols.
 *
 * Goal: block the *worst* names — slurs and strong profanity — and the
 * common "leetspeak" / spacing / homoglyph tricks people use to sneak them
 * past a naive blocklist (e.g. "f.u.c.k", "sh1t", "@sshole", "ＦＵＣＫ",
 * Cyrillic look-alikes, "fuuuuck"). This mirrors the moderation filters
 * commonly used on gaming platforms.
 *
 * Design notes:
 *  - Input is first "folded" to plain a–z letters: lower-cased, unicode
 *    normalised, homoglyph- and leet-mapped, with separators stripped. This
 *    is what catches the variations.
 *  - Severe, low-collision terms are matched as a *substring* so they are
 *    caught even when embedded (e.g. "motherfucker"). An allow-list of safe
 *    words (Scunthorpe, shiitake, niggardly, …) is neutralised first to
 *    avoid the classic false positives.
 *  - Short / false-positive-prone terms (ass, sex, cock, …) are matched only
 *    as *whole words*, so "class", "Dickinson" or "cockpit" stay allowed.
 *
 * This is a client-side UX guard, not a security boundary: anyone can call
 * the token factory contract directly. Its job is to stop the wallet UI from
 * helping someone mint and surface abusive names on qrlwallet.com. The word
 * lists below are intentionally easy to tune.
 */

/** Shown to the user when a name/symbol is rejected. */
export const PROFANITY_REJECTION_MESSAGE =
    "This name contains language that isn't allowed. Please choose a different name.";

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Non-decomposable look-alike characters (Cyrillic / Greek) mapped to their
 * Latin equivalents. Accented Latin (é, ä, …) is handled by NFKD + combining
 * mark stripping, so it does not need entries here.
 */
const HOMOGLYPHS: Record<string, string> = {
    // Cyrillic
    а: "a", е: "e", о: "o", с: "c", р: "p", у: "y", х: "x", к: "k",
    м: "m", т: "t", н: "h", в: "b", і: "i", ј: "j", ѕ: "s", г: "r",
    // Greek
    α: "a", ε: "e", ο: "o", ι: "i", ρ: "p", τ: "t", κ: "k", χ: "x",
    υ: "y", ν: "v", ϲ: "c",
};

/** Leetspeak / symbol substitutions mapped to letters. */
const LEET: Record<string, string> = {
    "0": "o", "1": "i", "2": "z", "3": "e", "4": "a", "5": "s",
    "6": "g", "7": "t", "8": "b", "9": "g",
    "@": "a", $: "s", "!": "i", "|": "i", "¡": "i", "+": "t",
    "(": "c", "<": "c", "{": "c", "[": "c", "£": "l", "€": "e", "§": "s",
};

/**
 * Severe / low-collision terms matched anywhere in the folded text. Each is
 * protected by SUBSTRING_ALLOWLIST below so legitimate words containing them
 * are not flagged.
 */
const SUBSTRING_TERMS = [
    // racial / ethnic slurs
    "nigger", "nigga",
    // homophobic slur
    "faggot",
    // sexual exploitation
    "pedophile", "paedophile", "childporn",
    // strong profanity (caught even when embedded)
    "fuck", "motherfucker", "shit", "bullshit", "cunt", "bitch",
    "asshole", "dickhead", "cocksucker", "dumbass", "jackass",
];

/**
 * Words that legitimately contain a SUBSTRING_TERM and must NOT be flagged.
 * Neutralised before substring matching. Longest first so they are consumed
 * before any shorter overlap.
 */
const SUBSTRING_ALLOWLIST = [
    "sniggering", "sniggered", "snigger", "niggardly", "niggard", // "nigg…"
    "scunthorpe", // "cunt"
    "shiitake", "shitake", // "shit"
].sort((a, b) => b.length - a.length);

/**
 * Short or false-positive-prone terms matched only as whole words, so
 * "class", "bass", "cockpit", "Dickinson", "Sussex", "raccoon" stay allowed.
 */
const WORD_TERMS = [
    "arse", "arsehole", "ass", "asshat", "beaner", "bollocks", "chink",
    "cock", "coon", "cum", "dick", "dildo", "dyke", "fag", "gook", "heil",
    "hoe", "jizz", "kike", "kkk", "nazi", "negro", "porn", "prick", "pussy",
    "raghead", "rape", "rapist", "retard", "sex", "skank", "slut", "smegma",
    "spic", "tits", "titties", "towelhead", "tranny", "twat", "wank",
    "wanker", "wetback", "whore",
];

/**
 * Fold arbitrary text down to plain a–z, mapping homoglyphs and leetspeak.
 * Non-letters are left in place as separators (so word boundaries survive for
 * the whole-word stage); they are stripped later by `squash`.
 */
function foldToLetters(input: string): string {
    const lowered = input.toLowerCase().normalize("NFKD").replace(COMBINING_MARKS, "");
    let out = "";
    for (const ch of lowered) {
        const mapped = HOMOGLYPHS[ch] ?? LEET[ch];
        out += mapped ?? ch;
    }
    // Common digraph trick: "ph" -> "f" (e.g. "phuck").
    return out.replace(/ph/g, "f");
}

/** Strip everything except a–z. */
function squash(folded: string): string {
    return folded.replace(/[^a-z]+/g, "");
}

/** Split folded text into a–z word tokens. */
function wordsOf(folded: string): string[] {
    return folded.split(/[^a-z]+/).filter(Boolean);
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turn a term into a pattern that tolerates repeated characters (e.g.
 * "fuuuck"), since separators have already been stripped during folding.
 */
function repeatPattern(term: string): string {
    return term
        .split("")
        .map((c) => `${escapeRegex(c)}+`)
        .join("");
}

const SUBSTRING_REGEXES = SUBSTRING_TERMS.map((term) => ({
    term,
    re: new RegExp(repeatPattern(term)),
}));

const WORD_REGEXES = WORD_TERMS.map((term) => ({
    term,
    re: new RegExp(`^${repeatPattern(term)}$`),
}));

/**
 * Return the list of banned terms detected in `text` (mostly useful for
 * tests / logging). Empty array means the text is clean.
 */
export function findProfaneMatches(text: string): string[] {
    if (!text) return [];

    const folded = foldToLetters(text);
    const hits = new Set<string>();

    // 1) Substring stage. Neutralise allow-listed safe words first so they
    //    can't trigger a match (e.g. "Scunthorpe" -> no "cunt").
    let squashed = squash(folded);
    for (const safe of SUBSTRING_ALLOWLIST) {
        if (squashed.includes(safe)) squashed = squashed.split(safe).join(" ");
    }
    for (const { term, re } of SUBSTRING_REGEXES) {
        if (re.test(squashed)) hits.add(term);
    }

    // 2) Whole-word stage. Check each word token plus the fully-squashed form
    //    (to catch single-word separator injection like "s p i c").
    const candidates = wordsOf(folded);
    const squashedWhole = squash(folded);
    if (squashedWhole) candidates.push(squashedWhole);
    for (const { term, re } of WORD_REGEXES) {
        if (candidates.some((w) => re.test(w))) hits.add(term);
    }

    return [...hits];
}

/** True if `text` contains disallowed language. */
export function containsProfanity(text: string): boolean {
    return findProfaneMatches(text).length > 0;
}
