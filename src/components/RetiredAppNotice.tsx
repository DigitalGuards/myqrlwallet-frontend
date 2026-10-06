/**
 * Shown by the hosted build when it is opened inside an app version that
 * loaded qrlwallet.com over the network. Current app versions ship the wallet
 * inside the app, so the hosted page never has a native bridge to talk to.
 * See `isRetiredNativeApp`.
 */
const RetiredAppNotice = () => (
  <main className="p-8">
    <h1>Update MyQRLWallet</h1>
    <p>
      This version of the MyQRLWallet app is no longer supported. Install the
      latest version to keep using your wallet.
    </p>
    <p>
      Opened this page inside another app? Open qrlwallet.com in your regular
      browser.
    </p>
    <p>
      <a href="https://play.google.com/store/apps/details?id=com.chiefdg.myqrlwallet">
        Google Play
      </a>
      {" | "}
      <a href="https://myqrlwallet.com">myqrlwallet.com</a>
    </p>
  </main>
);

export default RetiredAppNotice;
