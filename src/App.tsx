import { store, StoreProvider } from './stores/store'
import { AppRouter } from './router/router'
import { isUnsupportedV3Context, V3_UNSUPPORTED_SIGNER_MESSAGE } from './config/runtimeProfile'

function App() {
  if (isUnsupportedV3Context()) {
    return <main className="p-8"><h1>Testnet v3 browser wallet</h1><p>{V3_UNSUPPORTED_SIGNER_MESSAGE}</p><p>Open this site in a regular browser to create or import a v3 account.</p></main>
  }
  return (
    <div className="h-full w-full">
      <StoreProvider value={store}>
        <AppRouter />
      </StoreProvider>
    </div>
  )
}

export default App
