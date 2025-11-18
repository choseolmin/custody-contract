// scripts/deploy_cold_v2.ts
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🚀 Deployer:", deployer.address);

  const omniAddr = process.env.OMNIBUS_VAULT_ADDR!;
  const backendEOA = process.env.BACKEND_EOA!;
  const admin1 = process.env.COLD_ADMIN1_ADDR!;
  const admin2 = process.env.COLD_ADMIN2_ADDR!;

  if (!omniAddr) throw new Error("OMNIBUS_VAULT_ADDR is not set");
  if (!backendEOA) throw new Error("BACKEND_EOA is not set");
  if (!admin1 || !admin2) throw new Error("COLD_ADMIN1_ADDR / COLD_ADMIN2_ADDR is not set");

  console.log("🧩 Settings:");
  console.log("  OmnibusVaultV2:", omniAddr);
  console.log("  Backend Manager:", backendEOA);
  console.log("  Cold Admin 1:", admin1);
  console.log("  Cold Admin 2:", admin2);

  // -----------------------------
  // 1) ColdVaultV2 배포
  // -----------------------------
  const ColdVault = await ethers.getContractFactory("ColdVault");
  const cold = await ColdVault.deploy(deployer.address);
  await cold.waitForDeployment();

  const coldAddr = await cold.getAddress();
  console.log("\n✅ ColdVaultV2 deployed at:", coldAddr);

  // -----------------------------
  // 2) ColdVaultV2에 Omnibus 주소 연결
  // -----------------------------
  const tx1 = await cold.setOmnibusVault(omniAddr);
  await tx1.wait();
  console.log("✅ ColdVault.setOmnibusVault(", omniAddr, ")");

  // -----------------------------
  // 3) ColdVaultV2에 admin1/admin2 등록
  // -----------------------------
  const tx2 = await cold.setColdAdmins(admin1, admin2);
  await tx2.wait();
  console.log("✅ ColdVault.setColdAdmins(", admin1, ",", admin2, ")");

  // -----------------------------
  // 4) ColdVaultV2 매니저 등록 (Backend EOA)
  // -----------------------------
  const tx3 = await cold.grantManager(backendEOA, true);
  await tx3.wait();
  console.log("✅ ColdVault.grantManager(", backendEOA, ")");

  // -----------------------------
  // 5) OmnibusVaultV2에 ColdVault 주소 연결
  // -----------------------------
  const omni = await ethers.getContractAt("OmnibusVaultV2", omniAddr, deployer);
  const tx4 = await omni.setColdVault(coldAddr);
  await tx4.wait();
  console.log("✅ OmnibusVaultV2.setColdVault(", coldAddr, ")");

  // Done
  console.log("\n🎉 Deployment & linking finished!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
