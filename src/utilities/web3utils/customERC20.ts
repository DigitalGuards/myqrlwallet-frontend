import Web3 from "@theqrl/web3";
import CustomERC20ABI from "@/abi/CustomERC20ABI";

const web3 = new Web3(new Web3.providers.HttpProvider(import.meta.env?.VITE_RPC_URL || "http://mainnet.zond.network:8545"));

const fetchBalance = async (contractAddress: string, accountAddress: string) => {
    const contract = new web3.zond.Contract(CustomERC20ABI, contractAddress);
    console.log(contractAddress, accountAddress, accountAddress.trim(), web3.utils.toChecksumAddress(accountAddress));
    const tokenInfo = await fetchTokenInfo(contractAddress)
    console.log(tokenInfo);
    const balance = await contract.methods.balanceOf(web3.utils.toChecksumAddress(accountAddress)).call()
    return balance;
}

const fetchTokenInfo = async (contractAddress: string) => {
    const contract = new web3.zond.Contract(CustomERC20ABI, contractAddress);
    const name = await contract.methods.name().call();
    const symbol = await contract.methods.symbol().call();
    const decimals = await contract.methods.decimals().call();
    return { name, symbol, decimals }
}

export { fetchBalance, fetchTokenInfo }