const { ethers } = require("ethers");
require("dotenv").config();

async function loadPolicyGuard() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL_PRIMARY);
  const owner = new ethers.Wallet(process.env.DEPLOYER_PK, provider);

  const pgAddr = process.env.POLICY_GUARD_ADDR;
  const abi = require("../artifacts/contracts/PolicyGuard.sol/PolicyGuard.json").abi;

  const pg = new ethers.Contract(pgAddr, abi, provider);
  const pgOwner = pg.connect(owner);

  return { pg, pgOwner, provider };
}

module.exports = { loadPolicyGuard };
