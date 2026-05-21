import { ethers } from "ethers";

const rpcUrl = process.env.EVM_RPC_URL || "https://api.infra.testnet.somnia.network";
const provider = new ethers.JsonRpcProvider(rpcUrl);

const privateKey = process.env.BOT_PRIVATE_KEY;
let wallet: ethers.Wallet | null = null;

if (privateKey && privateKey !== "YOUR_BOT_PRIVATE_KEY_HERE" && privateKey.trim() !== "") {
  try {
    wallet = new ethers.Wallet(privateKey, provider);
  } catch (error) {
    console.error("[VeloRail EVM] Failed to initialize wallet from BOT_PRIVATE_KEY:", error);
  }
}

/**
 * Validates if a string is a valid EVM address format.
 */
export function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * Returns the public address of the configured bot wallet.
 */
export function getBotWalletAddress(): string {
  if (!wallet) {
    return "NOT_CONFIGURED";
  }
  return wallet.address;
}

/**
 * Checks balance of native tokens (STT) for the given address.
 * Defaults to the bot's wallet address if none is provided.
 */
export async function getWalletBalance(address?: string): Promise<string> {
  let targetAddress = address;
  if (!targetAddress) {
    if (!wallet) {
      throw new Error("Bot wallet private key not configured in .env.");
    }
    targetAddress = wallet.address;
  }

  if (!isValidAddress(targetAddress)) {
    throw new Error(`Invalid EVM address format: ${targetAddress}`);
  }

  const balanceBig = await provider.getBalance(targetAddress);
  return ethers.formatEther(balanceBig);
}

/**
 * Estimates the gas fee for a native token transfer (STT).
 * Performs a dry-run check to verify if the transfer will succeed.
 */
export async function estimateTransferGas(
  recipient: string,
  amount: number
): Promise<{ gasLimit: bigint; gasPrice: bigint; totalFeeEther: string }> {
  if (!isValidAddress(recipient)) {
    throw new Error(`Invalid recipient address format: ${recipient}`);
  }

  if (!wallet) {
    throw new Error("Bot wallet private key not configured in .env.");
  }

  const amountWei = ethers.parseEther(amount.toString());

  // Verify wallet has enough balance for the transfer amount first
  const balanceBig = await provider.getBalance(wallet.address);
  if (balanceBig < amountWei) {
    throw new Error(`Insufficient balance in bot wallet. Required: ${amount} STT, Available: ${ethers.formatEther(balanceBig)} STT.`);
  }

  const tx = {
    to: recipient,
    value: amountWei,
    from: wallet.address,
  };

  try {
    const gasLimit = await provider.estimateGas(tx);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits("1", "gwei");
    const totalFeeWei = gasLimit * gasPrice;
    const totalFeeEther = ethers.formatEther(totalFeeWei);

    return {
      gasLimit,
      gasPrice,
      totalFeeEther,
    };
  } catch (error: any) {
    // If dry-run fails due to gas or execution revert
    if (error.message && error.message.includes("insufficient funds")) {
      throw new Error(`Insufficient funds in bot wallet for transaction execution and gas fees.`);
    }
    throw new Error(`Gas estimation failed: ${error.reason || error.message || "Unknown execution revert."}`);
  }
}

/**
 * Executes a native token transfer (STT) on-chain.
 * Waits for 1 block confirmation and returns the transaction hash and actual gas used.
 */
export async function sendTransaction(
  recipient: string,
  amount: number
): Promise<{ txHash: string; gasCostEther: string }> {
  if (!isValidAddress(recipient)) {
    throw new Error(`Invalid recipient address format: ${recipient}`);
  }

  if (!wallet) {
    throw new Error("Bot wallet private key not configured in .env.");
  }

  const amountWei = ethers.parseEther(amount.toString());

  // Run dry-run estimation to ensure validity prior to broadcasting
  const { gasPrice } = await estimateTransferGas(recipient, amount);

  // Send transaction
  const txResponse = await wallet.sendTransaction({
    to: recipient,
    value: amountWei,
  });

  // Wait for block confirmation
  const receipt = await txResponse.wait(1);
  if (!receipt) {
    throw new Error("Transaction transaction was dropped or failed during block inclusion.");
  }

  const gasUsed = receipt.gasUsed;
  const gasPriceUsed = receipt.gasPrice || gasPrice;
  const gasCostWei = gasUsed * gasPriceUsed;
  const gasCostEther = ethers.formatEther(gasCostWei);

  return {
    txHash: txResponse.hash,
    gasCostEther,
  };
}
