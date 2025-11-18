import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const policyGuardAddr = process.env.POLICY_GUARD_ADDR;
  const managerAddr = process.env.OMNI_MANAGER_ADDR;
  const tssAddr = process.env.TSS_ADDR; // 선택

  if (!policyGuardAddr) throw new Error("POLICY_GUARD_ADDR is not set");
  if (!managerAddr) throw new Error("OMNI_MANAGER_ADDR is not set");

  // Hardhat에 설정된 sepolia 계정 중 첫 번째를 deployer로 사용
  const [deployer] = await ethers.getSigners();

  console.log("🚀 Network       :", (await deployer.provider!.getNetwork()).name);
  console.log("🚀 Deployer      :", deployer.address);
  console.log("🛡 PolicyGuard   :", policyGuardAddr);
  console.log("👤 Manager       :", managerAddr);
  if (tssAddr) console.log("👤 TSS           :", tssAddr);

  // OmnibusVaultV2 컨트랙트 팩토리
  const OmniV2 = await ethers.getContractFactory("OmnibusVaultV2", deployer);

  console.log("⏳ Deploying OmnibusVaultV2...");
  const omni = await OmniV2.deploy(deployer.address, policyGuardAddr);

  // ethers v6 스타일: 배포 완료 대기
  await omni.waitForDeployment();

  const omniAddr = await omni.getAddress();
  const deployTx = omni.deploymentTransaction();
  console.log("✅ OmnibusVaultV2 deployed at:", omniAddr);
  if (deployTx) {
    console.log("   - deploy txHash:", deployTx.hash);
  }

  // 타입 문제 회피용 any 캐스팅
  const omniAny = omni as any;

  // ─────────────────────
  // 0) 기본 상태 확인
  // ─────────────────────
  const owner = await omniAny.owner();
  const pgInVault = await omniAny.policyGuard();

  console.log("👑 owner()           :", owner);
  console.log("🛡 policyGuard()     :", pgInVault);

  // ─────────────────────
  // 1) Manager 등록
  // ─────────────────────
  console.log("⏳ Granting manager role to:", managerAddr);
  const txMgr = await omniAny.grantManager(managerAddr, true);
  const rcMgr = await txMgr.wait();
  console.log("✅ grantManager txHash:", rcMgr.hash);
  console.log("   isManager(manager) :", await omniAny.isManager(managerAddr));

  // ─────────────────────
  // 2) (선택) TSS 설정
  // ─────────────────────
  if (tssAddr) {
    console.log("⏳ Setting TSS (seatA) to:", tssAddr);
    const txTss = await omniAny.setTss(tssAddr);
    const rcTss = await txTss.wait();
    console.log("✅ setTss txHash      :", rcTss.hash);
    console.log("   seatATss()         :", await omniAny.seatATss());
    console.log("   isTss(TSS_ADDR)    :", await omniAny.isTss(tssAddr));
  } else {
    console.log("⚠️ TSS_ADDR not set. You must call setTss later manually.");
  }

  console.log("🎉 Deployment & initial setup complete!");
  console.log("   OmnibusVaultV2:", omniAddr);
  console.log("   PolicyGuard   :", pgInVault);
  console.log("   Manager       :", managerAddr);
  if (tssAddr) {
    console.log("   TSS           :", tssAddr);
  }
}

main().catch((err) => {
  console.error("💥 deployOmnibusVaultV2 failed:", err);
  process.exit(1);
});
