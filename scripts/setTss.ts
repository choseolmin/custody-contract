import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL_PRIMARY!;
  const ownerPk = process.env.DEPLOYER_PK!;
  const omnibus = process.env.OMNIBUS_VAULT_ADDR!;
  const newTss = process.env.NEW_TSS_ADDR!;   // ← 네가 TSS로 넣고 싶은 주소

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(ownerPk, provider);

  const abi = [
    "function setTss(address tss) external",
    "function seatATss() view returns (address)"
  ];

  const vault = new ethers.Contract(omnibus, abi, wallet);

  console.log("⏳ Sending setTss...");
  const tx = await vault.setTss(newTss);
  console.log("📨 txHash:", tx.hash);

  const receipt = await tx.wait();
  console.log("✅ confirmed in block:", receipt.blockNumber);

  const current = await vault.seatATss();
  console.log("🔍 New TSS:", current);
}

main().catch(console.error);
