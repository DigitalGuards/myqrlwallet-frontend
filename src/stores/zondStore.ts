import { ZOND_PROVIDER } from "../configuration/zondConfig";
import { getHexSeedFromMnemonic } from "../functions/getHexSeedFromMnemonic";
import StorageUtil from "../utilities/storageUtil";
import log from "../utilities/logUtil"; // Assuming there's a log utility
import Web3, {
  TransactionReceipt,
  Web3ZondInterface,
  utils,
} from "@theqrl/web3";
import { action, makeAutoObservable, observable, runInAction } from "mobx";
import { customERC20FactoryABI } from "@/abi/CustomERC20FactoryABI";
import { fetchTokenInfo } from "@/utilities/web3utils/customERC20";
import { TokenInterface } from "@/lib/constants";
import { KNOWN_TOKEN_LIST } from "@/lib/constants";
type ActiveAccountType = {
  accountAddress: string;
};

type ZondAccountType = {
  accountAddress: string;
  accountBalance: string;
};

type ZondAccountsType = {
  accounts: ZondAccountType[];
  isLoading: boolean;
};

type CreatingTokenType = {
  name: string;
  creating: boolean;
}

type CreatedTokenType = {
  name: string;
  symbol: string;
  decimals: number;
  address: string;
}

class ZondStore {
  zondInstance?: Web3ZondInterface;
  zondConnection = {
    isConnected: false,
    isLoading: false,
    zondNetworkName: "",
    blockchain: "",
  };
  zondAccounts: ZondAccountsType = { accounts: [], isLoading: false };
  activeAccount: ActiveAccountType = { accountAddress: "" };
  creatingToken: CreatingTokenType = { name: "", creating: false };
  createdToken: CreatedTokenType = { name: "", symbol: "", decimals: 0, address: "" };
  tokenList: TokenInterface[] = [];

  constructor() {
    makeAutoObservable(this, {
      zondInstance: observable.struct,
      zondConnection: observable.struct,
      zondAccounts: observable.struct,
      activeAccount: observable.struct,
      creatingToken: observable.struct,
      createdToken: observable.struct,
      tokenList: observable.struct,
      addToken: action.bound,
      removeToken: action.bound,
      setCreatedToken: action.bound,
      setCreatingToken: action.bound,
      selectBlockchain: action.bound,
      setActiveAccount: action.bound,
      fetchZondConnection: action.bound,
      fetchAccounts: action.bound,
      getAccountBalance: action.bound,
      signAndSendTransaction: action.bound,
      createToken: action.bound,
    });

    // Log initialization
    log("ZondStore initialized");

    // Initialize blockchain asynchronously to avoid blocking constructor
    setTimeout(() => {
      this.initializeBlockchain();
    }, 0);
  }

  async initializeBlockchain() {
    try {
      const selectedBlockChain = await StorageUtil.getBlockChain();
      const { name, url } = ZOND_PROVIDER[selectedBlockChain];

      runInAction(() => {
        this.zondConnection = {
          ...this.zondConnection,
          zondNetworkName: name,
          blockchain: selectedBlockChain,
        };
      });

      const zondHttpProvider = new Web3.providers.HttpProvider(url);
      const { zond } = new Web3({ provider: zondHttpProvider });

      runInAction(() => {
        this.zondInstance = zond;
      });

      this.tokenList = await StorageUtil.getTokenList();

      KNOWN_TOKEN_LIST.forEach(async (token) => {
        await this.addToken(token);
      });

      await this.fetchZondConnection();
      await this.fetchAccounts();
      await this.validateActiveAccount();

      // Log successful initialization
      log("Blockchain initialized successfully");
    } catch (error) {
      console.error('Failed to initialize blockchain:', error);
      log("Error initializing blockchain: " + error);
    }
  }

  async selectBlockchain(selectedBlockchain: string) {
    await StorageUtil.setBlockChain(selectedBlockchain);
    await this.initializeBlockchain();
  }

  async setCreatingToken(name: string, creating: boolean) {
    this.creatingToken = { name, creating };
  }

  async setCreatedToken(name: string, symbol: string, decimals: number, address: string) {
    await StorageUtil.setCreatedToken(name, symbol, decimals, address);
    this.createdToken = { name, symbol, decimals, address };
  }

  async addToken(token: TokenInterface) {
    if (!this.tokenList.some(t => t.address.toLowerCase() === token.address.toLowerCase())) {
      await StorageUtil.updateTokenList([...this.tokenList, token]);
      this.tokenList = [...this.tokenList, token];
      return token;
    } else {
      return null;
    }
  }

  async removeToken(token: TokenInterface) {
    await StorageUtil.updateTokenList(this.tokenList.filter(t => t.address.toLowerCase() !== token.address.toLowerCase()));
    this.tokenList = this.tokenList.filter(t => t.address !== token.address);
  }

  async setActiveAccount(activeAccount?: string) {
    await StorageUtil.setActiveAccount(
      this.zondConnection.blockchain,
      activeAccount,
    );
    this.activeAccount = {
      ...this.activeAccount,
      accountAddress: activeAccount ?? "",
    };

    let storedAccountList: string[] = [];
    try {
      const accountListFromStorage = await StorageUtil.getAccountList(
        this.zondConnection.blockchain,
      );
      storedAccountList = [...accountListFromStorage];
      if (activeAccount) {
        storedAccountList.push(activeAccount);
      }
      storedAccountList = [...new Set(storedAccountList)];
    } finally {
      await StorageUtil.setAccountList(
        this.zondConnection.blockchain,
        storedAccountList,
      );
      await this.fetchAccounts();
    }
  }

  async fetchZondConnection() {
    this.zondConnection = { ...this.zondConnection, isLoading: true };
    try {
      const isListening = (await this.zondInstance?.net.isListening()) ?? false;
      runInAction(() => {
        this.zondConnection = {
          ...this.zondConnection,
          isConnected: isListening,
        };
      });
    } catch (error) {
      runInAction(() => {
        this.zondConnection = { ...this.zondConnection, isConnected: false };
      });
    } finally {
      runInAction(() => {
        this.zondConnection = { ...this.zondConnection, isLoading: false };
      });
    }
  }

  async fetchAccounts() {
    this.zondAccounts = { ...this.zondAccounts, isLoading: true };

    let storedAccountsList: string[] = [];
    const accountListFromStorage = await StorageUtil.getAccountList(
      this.zondConnection.blockchain,
    );
    storedAccountsList = accountListFromStorage;
    try {
      const accountsWithBalance: ZondAccountsType["accounts"] =
        await Promise.all(
          storedAccountsList.map(async (account) => {
            const accountBalance =
              (await this.zondInstance?.getBalance(account)) ?? BigInt(0);
            const convertedAccountBalance = utils
              .fromWei(accountBalance, "ether")
              .concat(" QRL");
            return {
              accountAddress: account,
              accountBalance: convertedAccountBalance,
            };
          }),
        );
      runInAction(() => {
        this.zondAccounts = {
          ...this.zondAccounts,
          accounts: accountsWithBalance,
        };
      });
    } catch (error) {
      runInAction(() => {
        this.zondAccounts = {
          ...this.zondAccounts,
          accounts: storedAccountsList.map((account) => ({
            accountAddress: account,
            accountBalance: "0",
          })),
        };
      });
    } finally {
      runInAction(() => {
        this.zondAccounts = { ...this.zondAccounts, isLoading: false };
      });
    }
  }

  async validateActiveAccount() {
    try {
      const storedActiveAccount = await StorageUtil.getActiveAccount(
        this.zondConnection.blockchain,
      );

      const confirmedExistingActiveAccount =
        this.zondAccounts.accounts.find(
          (account) => account.accountAddress === storedActiveAccount,
        )?.accountAddress ?? "";

      if (!confirmedExistingActiveAccount) {
        await StorageUtil.clearActiveAccount(this.zondConnection.blockchain);
      }

      this.activeAccount = {
        ...this.activeAccount,
        accountAddress: confirmedExistingActiveAccount,
      };

      // Only log if we actually have an active account
      if (confirmedExistingActiveAccount) {
        log("Active account validated: " + confirmedExistingActiveAccount);
      }
    } catch (error) {
      console.error('Failed to validate active account:', error);
      log("Error validating active account: " + error);
    }
  }

  getAccountBalance(accountAddress: string) {
    return (
      this.zondAccounts.accounts.find(
        (account) => account.accountAddress === accountAddress,
      )?.accountBalance ?? "0 QRL"
    );
  }

  async signAndSendTransaction(
    from: string,
    to: string,
    value: number,
    mnemonicPhrases: string,
  ) {
    let transaction: {
      transactionReceipt?: TransactionReceipt;
      error: string;
    } = { transactionReceipt: undefined, error: "" };

    try {
      const transactionObject = {
        from,
        to,
        value: utils.toWei(value, "ether"),
        maxFeePerGas: 21000,
        maxPriorityFeePerGas: 21000,
      };
      const signedTransaction =
        await this.zondInstance?.accounts.signTransaction(
          transactionObject,
          getHexSeedFromMnemonic(mnemonicPhrases),
        );
      if (signedTransaction) {
        const transactionReceipt =
          await this.zondInstance?.sendSignedTransaction(
            signedTransaction?.rawTransaction,
          );
        transaction = { ...transaction, transactionReceipt };
      } else {
        throw new Error("Transaction could not be signed");
      }
    } catch (error) {
      transaction = {
        ...transaction,
        error: `Transaction could not be completed. ${error}`,
      };
    }

    return transaction;
  }

  async createToken(
    tokenName: string,
    tokenSymbol: string,
    initialSupply: string,
    decimals: number,
    maxSupply: string,
    receipt: string,
    owner: string,
    maxWalletAmount: string,
    maxTxLimit: string,
    mnemonicPhrases: string
  ) {
    this.setCreatingToken(tokenName, true);
    const selectedBlockChain = await StorageUtil.getBlockChain();
    const { url } = ZOND_PROVIDER[selectedBlockChain];
    const seed = getHexSeedFromMnemonic(mnemonicPhrases);
    const web3 = new Web3(new Web3.providers.HttpProvider(url));
    const acc = web3.zond.accounts.seedToAccount(seed)
    web3.zond.wallet?.add(seed);
    web3.zond.transactionConfirmationBlocks = 1;

    const confirmationHandler = (data: any) => {
      this.setCreatingToken("", false);
      console.log(data);
    }

    const receiptHandler = async (data: any) => {
      const erc20TokenAddress = `0x${data.logs[3].topics[1].slice(-40)}`
      const { name, symbol, decimals } = await fetchTokenInfo(erc20TokenAddress);
      this.setCreatedToken(name, symbol, parseInt(decimals.toString()), erc20TokenAddress);
    }

    const errorHandler = (data: any) => {
      console.error(data);
    }

    const contractAddress = import.meta.env.VITE_CUSTOMERC20FACTORY_ADDRESS || "";

    const customERC20Factorycontract = new web3.zond.Contract(customERC20FactoryABI, contractAddress);

    const contractCreateToken = customERC20Factorycontract.methods.createToken(
      tokenName, tokenSymbol, BigInt(initialSupply.toString()).toString(), decimals, BigInt(maxSupply.toString()).toString(), receipt, owner, BigInt(maxWalletAmount.toString()).toString(), BigInt(maxTxLimit.toString()).toString()
    )

    const estimateGas = await contractCreateToken.estimateGas({ "from": acc.address })

    const txObj = { type: '0x2', gas: estimateGas, from: acc.address, data: contractCreateToken.encodeABI(), to: contractAddress }

    await web3.zond.sendTransaction(txObj, undefined, {
      checkRevertBeforeSending: true
    })
      .on('confirmation', confirmationHandler)
      .on('receipt', receiptHandler)
      .on('error', errorHandler)
  }
}

export default ZondStore;
