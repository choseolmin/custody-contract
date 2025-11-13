import { expect } from "chai";
import { ethers } from "hardhat";

describe("OmnibusVault: deposit", () => {
  it("EOA로 입금 시 Deposit 이벤트 발생", async () => {
    const [owner, tss, manager, user] = await ethers.getSigners();

    // 1) PolicyGuard 배포 (owner를 초기 오너로)
    const P = await ethers.getContractFactory("PolicyGuard");
    const policy = await P.deploy(await owner.getAddress());
    await policy.waitForDeployment();

    // 2) OmnibusVault 배포
    const V = await ethers.getContractFactory("OmnibusVault");
    const vault = await V.deploy(await owner.getAddress(), await policy.getAddress());
    await vault.waitForDeployment();

    // 3) 역할 설정 (TSS/Manager 등록)
    await (await vault.setTss(await tss.getAddress())).wait();
    await (await vault.grantManager(await manager.getAddress(), true)).wait();

    // 4) 사용자 입금
    const userKey = ethers.encodeBytes32String("user-1");
    await expect(
      vault.connect(user).depositETH(userKey, { value: ethers.parseEther("0.5") })
    ).to.emit(vault, "Deposit");
  });
});
