// scripts/check.policy.manager.ts
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const POLICY_ADDR = "0xA775351892e31f9aFf1f55F5a9F53B375930FEfC";
  const BACKEND_EOA = process.env.BACKEND_EOA;

  if (!BACKEND_EOA) {
    throw new Error("BACKEND_EOA가 .env에 없습니다.");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);

  const policy = await ethers.getContractAt("PolicyGuard", POLICY_ADDR, deployer);

  const owner = await policy.owner();
  console.log("owner():", owner);

  const isMgr = await policy.isManager(BACKEND_EOA);
  console.log(`isManager(BACKEND_EOA=${BACKEND_EOA}):`, isMgr);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
