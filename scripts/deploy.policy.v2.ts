// scripts/deploy.policy.v2.ts
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const backendEoa = process.env.BACKEND_EOA;

  console.log("=== PolicyGuard v2 Deploy ===");
  console.log(`Deployer (owner): ${deployer.address}`);

  if (backendEoa) {
    console.log(`BACKEND_EOA (manager 예정): ${backendEoa}`);
  } else {
    console.log("⚠️ BACKEND_EOA 가 .env 에 없습니다. grantManager 는 스킵됩니다.");
  }

  // 1) PolicyGuard v2 배포
  const Policy = await ethers.getContractFactory("PolicyGuard");
  const policy = await Policy.deploy(deployer.address);
  await policy.waitForDeployment();
  const policyAddr = await policy.getAddress();

  console.log(`✅ PolicyGuard v2 deployed at: ${policyAddr}`);

  // 2) BACKEND_EOA 를 Manager 로 등록
  if (backendEoa && backendEoa !== "" && backendEoa !== ethers.ZeroAddress) {
    console.log(`⏳ grantManager(${backendEoa}, true) 실행 중...`);
    const tx = await policy.grantManager(backendEoa, true);
    await tx.wait();
    console.log(`✅ grantManager(${backendEoa}, true) 완료`);
  } else {
    console.log("⚠️ BACKEND_EOA 미설정 → PolicyGuard Manager 등록은 건너뜀");
  }

  console.log("\n다음 단계:");
  console.log(`1) OmnibusVault.setPolicyGuard(${policyAddr}) 를 owner 계정으로 한 번 호출해야 합니다.`);
  console.log("2) 백엔드 .env 의 POLICY_GUARD 주소를 위 주소로 업데이트하세요.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
