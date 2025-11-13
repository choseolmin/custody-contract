import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  console.log("Deployer:", deployerAddr);

  // 1) PolicyGuard 배포
  const Policy = await ethers.getContractFactory("PolicyGuard");
  const policy = await Policy.deploy(deployerAddr);
  await policy.waitForDeployment();
  const policyAddr = await policy.getAddress();
  console.log("PolicyGuard:", policyAddr);

  // 2) OmnibusVault 배포
  const Vault = await ethers.getContractFactory("OmnibusVault");
  const vault = await Vault.deploy(deployerAddr, policyAddr);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("OmnibusVault:", vaultAddr);

  // 3) ColdVault 배포
  const Cold = await ethers.getContractFactory("ColdVault");
  const cold = await Cold.deploy(deployerAddr);
  await cold.waitForDeployment();
  const coldAddr = await cold.getAddress();
  console.log("ColdVault:", coldAddr);

  // =====================================================
  // 4) 좌석/역할/연결 세팅 (환경변수 기반, 있으면 세팅, 없으면 스킵)
  // =====================================================
  const seatA = process.env.SEAT_A_TSS_ADDR;      // TSS 좌석 (Seat A)
  const seatB = process.env.SEAT_B_ADMIN_ADDR;    // Manager 좌석 (Seat B)
  const coldAdmin1 = process.env.COLD_ADMIN1_ADDR;
  const coldAdmin2 = process.env.COLD_ADMIN2_ADDR;

  // Omnibus ↔ Cold 연결 (이건 필수니까 무조건 실행)
  {
    const tx1 = await vault.setColdVault(coldAddr);
    await tx1.wait();
    console.log("✔ setColdVault:", coldAddr);

    const tx2 = await cold.setOmnibusVault(vaultAddr);
    await tx2.wait();
    console.log("✔ setOmnibusVault:", vaultAddr);
  }

  // Seat A(TSS)
  if (seatA && seatA !== "") {
    const tx = await vault.setTss(seatA);
    await tx.wait();
    console.log("✔ setTss (Seat A, TSS):", seatA);
  } else {
    console.log("⚠️ SEAT_A_TSS_ADDR not set → setTss 스킵됨");
  }

  // Seat B(Manager)
  if (seatB && seatB !== "") {
    const tx = await vault.grantManager(seatB, true);
    await tx.wait();
    console.log("✔ grantManager (Seat B, Manager):", seatB);
  } else {
    console.log("⚠️ SEAT_B_ADMIN_ADDR not set → grantManager 스킵됨");
  }

  // ColdVault Admin 2/2
  if (coldAdmin1 && coldAdmin1 !== "" && coldAdmin2 && coldAdmin2 !== "") {
    const tx = await cold.setColdAdmins(coldAdmin1, coldAdmin2);
    await tx.wait();
    console.log("✔ setColdAdmins:", coldAdmin1, coldAdmin2);
  } else {
    console.log("⚠️ COLD_ADMIN1_ADDR / COLD_ADMIN2_ADDR not set → setColdAdmins 스킵됨");
  }

  console.log("\n✅ Deploy & wiring 완료");
  console.log("   PolicyGuard:", policyAddr);
  console.log("   OmnibusVault:", vaultAddr);
  console.log("   ColdVault:", coldAddr);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
