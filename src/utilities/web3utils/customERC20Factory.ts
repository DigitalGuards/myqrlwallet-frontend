import Web3 from "@theqrl/web3";
import { customERC20FactoryABI } from "@/abi/CustomERC20FactoryABI";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";

const web3 = new Web3(new Web3.providers.HttpProvider(import.meta.env?.VITE_RPC_URL || "http://mainnet.zond.network:8545"));

const hexSeed = getHexSeedFromMnemonic(import.meta.env?.VITE_SEED);

const acc = web3.zond.accounts.seedToAccount(hexSeed);

web3.zond.wallet?.add(hexSeed);

web3.zond.transactionConfirmationBlocks = 3;

const confirmationHandler = (data: any) => {
    console.log(data)
}

const receiptHandler = (data: any) => {
    console.log(data)
}

export const createToken = async () => {
    console.log(import.meta.env?.VITE_RPC_URL)
    const contractAddress = "0xf466bb03d0fe24547d6c4287fbb2f418256755b2";
    const contract1 = new web3.zond.Contract(customERC20FactoryABI, contractAddress);

    const contractCreateToken = contract1.methods.createToken("FrontendToken", "FTK", "1000000000000000000000000000", 18, "1000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "100000000000000000000000", "100000000000000000000000");

    const estimateGas = await contractCreateToken.estimateGas({ "from": acc.address })

    const txObj = { type: '0x2', gas: estimateGas, from: acc.address, data: contractCreateToken.encodeABI(), to: contractAddress }

    await web3.zond.sendTransaction(txObj, undefined, { checkRevertBeforeSending: true })
        .on('confirmation', confirmationHandler)
        .on('receipt', receiptHandler)
        .on('error', console.error)
}
