import Web3 from "@theqrl/web3";
import { customERC20FactoryABI } from "@/abi/CustomERC20FactoryABI";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";

const confirmationHandler = (data: any) => {
    console.log(data)
}

const receiptHandler = (data: any) => {
    console.log(data)
}

export const createToken = async (seed: string, rpc_url: string) => {
    const web3 = new Web3(new Web3.providers.HttpProvider(rpc_url));

    const hexSeed = getHexSeedFromMnemonic(seed);

    const acc = web3.zond.accounts.seedToAccount(hexSeed);

    web3.zond.wallet?.add(hexSeed);

    web3.zond.transactionConfirmationBlocks = 3;

    const contractAddress = "Z0b895c819d249e4016bb603bdcbf6a38b4251c1a";
    const contract1 = new web3.zond.Contract(customERC20FactoryABI, contractAddress);

    const contractCreateToken = contract1.methods.createToken("FrontendToken", "FTK", "1000000000000000000000000000", 18, "1000000000000000000000000000", "Z0000000000000000000000000000000000000000", "Z0000000000000000000000000000000000000000", "100000000000000000000000", "100000000000000000000000");

    const estimateGas = await contractCreateToken.estimateGas({ "from": acc.address })

    const txObj = { type: '0x2', gas: estimateGas, from: acc.address, data: contractCreateToken.encodeABI(), to: contractAddress }

    await web3.zond.sendTransaction(txObj, undefined, { checkRevertBeforeSending: true })
        .on('confirmation', confirmationHandler)
        .on('receipt', receiptHandler)
        .on('error', console.error)
}
