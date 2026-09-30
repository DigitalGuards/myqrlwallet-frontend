/**
 * One answer per dApp request, sent as early as it is owed.
 *
 * `qrl_sendTransaction` owes the dApp the transaction hash, which exists the
 * moment the node accepts the broadcast. Answering only on the receipt made
 * the answer depend on the wallet still being open a minute later, and on a
 * phone it is not: the user approves, switches back to the dApp, the wallet
 * backgrounds and locks, and the relay drops. A transaction that mined
 * perfectly well then goes unreported, and a user who sees no result sends
 * again and pays twice.
 *
 * Once the hash is out, a later revert is not a rejection. The dApp holds a
 * real transaction and observes its outcome on chain, exactly as it would with
 * any other wallet. Rejecting afterwards would tell it the request failed
 * while the transaction is on its way, which is the same lie in the other
 * direction.
 *
 * Confirmation stays in the wallet as progress, which is a local concern.
 */

export interface DAppRequestSender {
  approve(result: unknown): void;
  reject(message: string): void;
}

export interface DAppRequestAnswer {
  /** Answer with a result. Ignored once answered. */
  answer(result: unknown): void;
  /** Reject. Ignored once answered, including after a successful broadcast. */
  reject(message: string): void;
  /** Whether the dApp already has its answer. */
  readonly answered: boolean;
}

export function createDAppRequestAnswer(
  sender: DAppRequestSender,
): DAppRequestAnswer {
  let answered = false;
  return {
    answer(result: unknown): void {
      if (answered) return;
      answered = true;
      sender.approve(result);
    },
    reject(message: string): void {
      if (answered) return;
      answered = true;
      sender.reject(message);
    },
    get answered(): boolean {
      return answered;
    },
  };
}
