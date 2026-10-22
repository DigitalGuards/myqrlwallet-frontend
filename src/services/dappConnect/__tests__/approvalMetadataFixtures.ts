// Shared by the real-validator tests and the built-wallet browser probes.
const urlPrefix = "https://dapp.example/";
const iconPrefix = "data:image/jpeg;base64,";
const maximumMetadata = {
  name: "W".repeat(128),
  url: urlPrefix + "a".repeat(2048 - urlPrefix.length),
  // The raster prefix plus a multiple of four base64 characters must fit 64 KiB.
  icon: iconPrefix + "AAAA".repeat(Math.floor((65536 - iconPrefix.length) / 4)),
  chainId: "0x301825",
};

export const approvalMetadataCases = [
  {
    name: "url-1600",
    input: {
      name: "Example dApp",
      url: urlPrefix + "a".repeat(1600 - urlPrefix.length),
      chainId: "0x301825",
    },
  },
  {
    name: "maximum-metadata",
    input: {
      ...maximumMetadata,
      // Description has no validator limit: it is discarded before approval.
      description: "D".repeat(65536),
    },
  },
  {
    name: "encoded-metadata",
    input: {
      ...maximumMetadata,
      name: "应用程序 ".repeat(25) + "应用程",
      // Canonicalization expands accepted Unicode paths beyond the input cap.
      url: urlPrefix + "界".repeat(2048 - urlPrefix.length),
      description: "D".repeat(65536),
    },
  },
].map(({ name, input }) => ({
  name,
  input,
  metadata: {
    name: input.name,
    url: new URL(input.url).toString(),
    chainId: input.chainId,
    ...("icon" in input ? { icon: input.icon } : {}),
  },
}));
