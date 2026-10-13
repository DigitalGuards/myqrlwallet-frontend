import { displayAddress, historyRowView } from "@/utils/historyRow";
import type { HistoryRow } from "@/utils/transactionHistory";

const body = "599f6618".repeat(16);
const lower = `Q${body}`;
const upper = `Q${body.toUpperCase()}`;
const other = `Q${"ab12cd34".repeat(16)}`;
const hash = `0x${"c".repeat(64)}`;

const row = (patch: Partial<HistoryRow>): HistoryRow => ({
  ID: "1",
  InOut: 0,
  TxType: "0x2",
  Address: lower,
  From: lower,
  To: other,
  TxHash: hash,
  TimeStamp: "0x68000000",
  Amount: "1.5",
  BlockNumber: "0x1",
  state: "confirmed",
  ...patch,
});

describe("displayAddress", () => {
  it("renders every casing of one address identically", () => {
    expect(displayAddress(lower)).toBe(displayAddress(upper));
    expect(displayAddress(lower).startsWith("Q")).toBe(true);
  });

  it("leaves non-addresses untouched", () => {
    expect(displayAddress("not-an-address")).toBe("not-an-address");
  });
});

describe("historyRowView", () => {
  it("shows the same casing for the sender of a received row and the recipient of a sent row", () => {
    const received = historyRowView(row({ InOut: 1, From: lower, To: other }));
    const sent = historyRowView(row({ InOut: 0, From: other, To: upper }));
    expect(received.counterparty).toBe(sent.counterparty);
    expect(received.counterpartyLabel).toBe("From");
    expect(sent.counterpartyLabel).toBe("To");
  });

  it("signs amounts and tones by direction", () => {
    expect(historyRowView(row({ InOut: 1 }))).toMatchObject({
      title: "Received",
      amountTone: "success",
      unit: "Quanta",
    });
    expect(historyRowView(row({ InOut: 0 }))).toMatchObject({
      title: "Sent",
      amountTone: "danger",
    });
    expect(historyRowView(row({ Amount: "0" })).amount).toBe("0");
  });

  it("maps states to status text and tone", () => {
    expect(historyRowView(row({ state: "pending" }))).toMatchObject({
      status: "Pending",
      statusTone: "warning",
    });
    expect(historyRowView(row({ state: "failed" })).statusTone).toBe("danger");
    expect(historyRowView(row({ state: "dropped" })).status).toBe(
      "Failed (dropped or replaced)",
    );
    expect(historyRowView(row({ state: "confirmed" })).statusTone).toBe(
      "success",
    );
  });

  it("uses the token symbol and handles a missing counterparty", () => {
    expect(historyRowView(row({ asset: "MQW" })).unit).toBe("MQW");
    expect(historyRowView(row({ To: "" })).counterparty).toBeNull();
  });
});
