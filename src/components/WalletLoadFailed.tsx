/**
 * Rendered by main.tsx when the wallet code fails to load, so the visitor
 * sees what happened and how to recover.
 */
const WalletLoadFailed = () => (
  <main className="p-8">
    <h1>The wallet could not load</h1>
    <p>Check your connection and reload the page.</p>
  </main>
);

export default WalletLoadFailed;
