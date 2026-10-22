import { parseDAppInfo } from "../dappMetadata";
import { approvalMetadataCases } from "./approvalMetadataFixtures";

describe("approval layout metadata fixtures", () => {
  it.each(approvalMetadataCases)(
    "accepts $name through the real validator",
    ({ input, metadata }) => {
      expect(parseDAppInfo(input)).toEqual(metadata);
    },
  );

  it("exercises the largest accepted name, URL input and raster icon", () => {
    const fixture = approvalMetadataCases.find(
      ({ name }) => name === "maximum-metadata",
    );
    if (!fixture) throw new Error("Missing maximum metadata fixture");
    const { input } = fixture;
    if (!("icon" in input)) throw new Error("Missing maximum icon fixture");
    expect(input.name).toHaveLength(128);
    expect(input.url).toHaveLength(2048);
    expect(input.icon).toHaveLength(65535);
    expect(() => parseDAppInfo({ ...input, name: input.name + "W" })).toThrow();
    expect(() => parseDAppInfo({ ...input, url: input.url + "a" })).toThrow();
    // The base64 payload must be a multiple of four; the next size exceeds 64 KiB.
    expect(() =>
      parseDAppInfo({ ...input, icon: input.icon + "AAAA" }),
    ).toThrow();
  });

  it("discards descriptions of any size before approval", () => {
    const fixture = approvalMetadataCases[0];
    if (!fixture) throw new Error("Missing metadata fixture");
    for (const length of [0, 65536, 1048576]) {
      expect(
        parseDAppInfo({ ...fixture.input, description: "D".repeat(length) }),
      ).toEqual(fixture.metadata);
    }
  });

  it("covers the expanded canonical URL passed to approval", () => {
    const fixture = approvalMetadataCases.find(
      ({ name }) => name === "encoded-metadata",
    );
    if (!fixture) throw new Error("Missing encoded metadata fixture");
    expect(fixture.input.url).toHaveLength(2048);
    expect(parseDAppInfo(fixture.input).url).toHaveLength(18264);
  });
});
