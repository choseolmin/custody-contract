// scripts/wire.policy.to.omnibus.ts
import { ethers } from "hardhat";

async function main() {
  // 👉 여기에 실제 주소 넣기
  const OMNIBUS_VAULT_ADDR = "0xD2a40261950aff1302AD6a79711b4232BB2213A0";
  const NEW_POLICY_ADDR   = "0xA775351892e31f9aFf1f55F5a9F53B375930FEfC";

  const [deployer] = await ethers.getSigners();
  console.log("Deployer (owner expected):", deployer.address);

  // OmnibusVault 인스턴스 attach
  const vault = await ethers.getContractAt("OmnibusVault", OMNIBUS_VAULT_ADDR, deployer);

  // 현재 연결된 PolicyGuard 확인
  const before = await vault.policyGuard();
  console.log("Before policyGuard:", before);

  console.log(`⏳ setPolicyGuard(${NEW_POLICY_ADDR}) 호출 중...`);
  const tx = await vault.setPolicyGuard(NEW_POLICY_ADDR);
  await tx.wait();
  console.log("✅ setPolicyGuard 완료");

  const after = await vault.policyGuard();
  console.log("After policyGuard:", after);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
