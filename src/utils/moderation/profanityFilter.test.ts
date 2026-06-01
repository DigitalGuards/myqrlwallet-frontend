import { describe, it, expect } from "@jest/globals";
import { containsProfanity, findProfaneMatches } from "./profanityFilter";

describe("containsProfanity", () => {
    describe("allows legitimate names", () => {
        const clean = [
            "MyQRLWallet",
            "Quantum Coin",
            "Bitcoin",
            "Ethereum",
            "QRL",
            "MQW",
            "Doge To The Moon",
            "Web3 Token",
            "Stable USD",
            // classic false positives (the "Scunthorpe problem")
            "Scunthorpe",
            "Assassin",
            "Class Token",
            "Bass",
            "Grass",
            "Cockpit",
            "Cocktail",
            "Dickinson",
            "Shiitake",
            "niggardly",
            "Sussex",
            "Raccoon",
            "Therapy",
        ];

        it.each(clean)("%s", (name) => {
            expect(containsProfanity(name)).toBe(false);
        });
    });

    describe("blocks profanity and slurs", () => {
        const profane = [
            "fuck",
            "Fuck this token",
            "motherfucker",
            "shit coin",
            "bullshit",
            "asshole",
            "cunt",
            "bitch",
            "ASS",
            "Pussy",
            "faggot",
        ];

        it.each(profane)("%s", (name) => {
            expect(containsProfanity(name)).toBe(true);
        });
    });

    describe("blocks obfuscated variations", () => {
        const variations = [
            "f.u.c.k", // separators
            "f u c k", // spaces
            "FUUUUCK", // repeated chars
            "sh1t", // leetspeak
            "@sshole", // symbol substitution
            "$h1t", // mixed leet
            "ｆｕｃｋ", // fullwidth unicode
            "phuck", // ph -> f digraph
            "a$$", // symbol substitution, whole word
        ];

        it.each(variations)("%s", (name) => {
            expect(containsProfanity(name)).toBe(true);
        });
    });

    it("returns the matched term for debugging/logging", () => {
        expect(findProfaneMatches("clean name")).toEqual([]);
        expect(findProfaneMatches("sh1t")).toContain("shit");
    });

    it("treats empty input as clean", () => {
        expect(containsProfanity("")).toBe(false);
    });
});
