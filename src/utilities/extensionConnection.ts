import { ZOND_WEB3_WALLET_PROVIDER_INFO } from "@/lib/constants"; // Import constant for identification

// EIP-6963 types (simplified)
interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: any; // Adjust the type according to the actual provider interface
}

interface EIP6963AnnounceProviderEvent extends CustomEvent {
  detail: EIP6963ProviderDetail;
}

let zondProviderDetail: EIP6963ProviderDetail | null = null;

// Function to find the Zond provider via EIP-6963
function findZondProvider(): Promise<EIP6963ProviderDetail | null> {
  return new Promise((resolve) => {
    let isResolved = false;
    const handleAnnounceProvider = (event: Event) => {
      const announceEvent = event as EIP6963AnnounceProviderEvent;
      // Check if the announced provider is the Zond Wallet (using RDNS)
      if (announceEvent.detail.info.rdns === ZOND_WEB3_WALLET_PROVIDER_INFO.RDNS) {
        console.log("Zond Wallet Provider Found (EIP-6963):", announceEvent.detail);
        zondProviderDetail = announceEvent.detail;
        if (!isResolved) {
          isResolved = true;
          window.removeEventListener("eip6963:announceProvider", handleAnnounceProvider);
          resolve(zondProviderDetail);
        }
      }
    };

    window.addEventListener("eip6963:announceProvider", handleAnnounceProvider);

    // Dispatch the request event to prompt providers to announce themselves again
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Set a timeout in case the provider is not found quickly
    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        window.removeEventListener("eip6963:announceProvider", handleAnnounceProvider);
        resolve(zondProviderDetail); // Resolve with whatever was found (null if nothing)
      }
    }, 1000); // Wait 1 second
  });
}

// Modify the function signature to accept setActiveAccount and setExtensionProvider
async function connectToExtension(
  setActiveAccount: (address: string) => Promise<void>,
  setExtensionProvider: (provider: any | null) => void // Add the new setter
): Promise<string[] | null> {
  // Attempt to find the provider via EIP-6963
  const foundProviderDetail = await findZondProvider();

  if (!foundProviderDetail) {
    console.error("Zond Wallet extension provider not found (EIP-6963).");
    alert("Zond Wallet Extension not detected. Please ensure it is installed and enabled.");
    setExtensionProvider(null); // Ensure provider is cleared if not found
    return null;
  }

  const provider = foundProviderDetail.provider;

  try {
    // Request account access using the ZOND-specific method
    console.log("Attempting to connect using zond_requestAccounts...");
    const accounts = await provider.request({ method: 'zond_requestAccounts' }); 
    
    if (accounts && accounts.length > 0) {
      const firstAccount = accounts[0];
      console.log("Connected to extension with accounts:", accounts);
      
      // Call the passed-in setActiveAccount function
      console.log(`Setting active account to: ${firstAccount}`);
      await setActiveAccount(firstAccount);
      
      // Set the extension provider in the store
      console.log("Setting extension provider in store.");
      setExtensionProvider(provider);
            
      return accounts;
    } else {
      console.warn("No accounts returned from extension.");
      setExtensionProvider(null); // Clear provider if no accounts approved
      return null;
    }
  } catch (error: any) {
    setExtensionProvider(null); // Clear provider on error
    // Handle errors, such as user rejection
    if (error.code === 4001) { // EIP-1193 user rejection error
      console.log('User rejected connection request.');
      alert('Connection request rejected.');
    } else {
      // Check for the specific method not found error, although we expect zond_requestAccounts to exist now
      if (error.code === -32601) {
         console.error("RPC Error: Method not found", error);
         alert(`RPC Error: ${error.message}`);
      } else {
        console.error("Error connecting to extension:", error);
        alert(`Error connecting to extension: ${error.message || error}`);
      }
    }
    return null;
  }
}

export { connectToExtension }; 