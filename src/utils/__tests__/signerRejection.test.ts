import { isUserRejection } from "../signerRejection";
import { approvalRejection } from "../sendStatus";

it.each([
  { code: 4001 },
  new Error("User rejected the request."),
  new Error("user rejected signature"),
  { message: "Rejected by the user" },
  { message: "Transaction rejected by user" },
  "User denied transaction signature",
  new Error("request rejected"),
  { message: " Request rejected. " },
  "REQUEST REJECTED",
])("recognizes explicit signer refusal: %p", (error) => {
  expect(isUserRejection(error)).toBe(true);
  expect(approvalRejection(error)).toMatch(/declined/);
});

it.each([
  undefined,
  null,
  4001,
  [],
  {},
  { code: "4001" },
  { code: 4100, message: "Request rejected" },
  { code: -32000, message: "User rejected request" },
  { message: { text: "Request rejected" } },
  { reason: "Request rejected" },
  { data: { message: "Request rejected" } },
  new Error("RPC request rejected"),
  new Error("Request rejected: insufficient funds"),
  new Error("Request rejected by server"),
  new Error("User rejected signature verification failed"),
  new Error("Transport disconnected"),
  new Error("Request timeout: qrl_getTransactionReceipt"),
  new Error("Unknown failure"),
])("leaves unknown and technical failures unclassified: %p", (error) => {
  expect(isUserRejection(error)).toBe(false);
  expect(approvalRejection(error)).toBeNull();
});
