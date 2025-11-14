import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());

  const F = await ethers.getContractFactory("MerkleAnchor");
  const anchor = await F.deploy(await deployer.getAddress());
  await anchor.waitForDeployment();

  console.log("MerkleAnchor deployed at:", await anchor.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
