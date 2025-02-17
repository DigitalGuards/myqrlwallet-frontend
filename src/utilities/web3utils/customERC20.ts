import Web3 from "@theqrl/web3";
import CustomERC20ABI from "@/abi/CustomERC20ABI";

const web3 = new Web3(new Web3.providers.HttpProvider(import.meta.env?.VITE_RPC_URL || "http://mainnet.zond.network:8545"));

const fetchBalance = async (contractAddress: string, accountAddress: string) => {
    const contract = new web3.zond.Contract(CustomERC20ABI, contractAddress);
    const balance = await contract.methods.balanceOf(accountAddress).call()
    console.log(balance)
    return balance;
}

export { fetchBalance }