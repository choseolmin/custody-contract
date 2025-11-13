import { expect } from "chai";
import { ethers } from "hardhat";
import { ColdVault, OmnibusVault, PolicyGuard } from "../typechain-types";

describe("ColdVault: admin 2/2 required", () => {
  it("admin1 + admin2 둘 다 승인해야 executeMove 가능", async () => {
    const [owner, admin1, admin2, tss, manager] = await ethers.getSigners();

    // 배포
    const P = await ethers.getContractFactory("PolicyGuard");
    const policy = (await P.deploy(await owner.getAddress())) as PolicyGuard;
    await policy.waitForDeployment();

    const V = await ethers.getContractFactory("OmnibusVault");
    const vault = (await V.deploy(await owner.getAddress(), await policy.getAddress())) as OmnibusVault;
    await vault.waitForDeployment();

    const C = await ethers.getContractFactory("ColdVault");
    const cold = (await C.deploy(await owner.getAddress())) as ColdVault;
    await cold.waitForDeployment();

    // 좌석/연결

    await (await vault.setColdVault(await cold.getAddress())).wait();        // 🔹 OmnibusVault에 ColdVault 등록
    await (await cold.setOmnibusVault(await vault.getAddress())).wait();     // 🔹 ColdVault에 OmnibusVault 등록
    await (await cold.setColdAdmins(await admin1.getAddress(), await admin2.getAddress())).wait();

    // 콜드에 자금 적립(직접 전송 금지이므로 adminDeposit 사용)
    await (await cold.connect(owner).adminDeposit({ value: ethers.parseEther("1.0") })).wait();

    // moveId 계산(테스트 편의: staticCall로 미리 얻기)
    const amt = ethers.parseEther("0.2");
    const moveId = await cold.requestMove.staticCall(amt);
    await (await cold.requestMove(amt)).wait();

    // admin1 승인 → 아직 실행 불가
    await (await cold.connect(admin1).approveMove(moveId)).wait();
    await expect(cold.executeMove(moveId)).to.be.revertedWithCustomError(cold, "NotExecutable");

    // admin2 승인 → 실행 가능
    await (await cold.connect(admin2).approveMove(moveId)).wait();

    // 실행(오너 경로), 내부에서 OmnibusVault.fromCold(...) 호출
    await expect(cold.executeMove(moveId)).to.emit(cold, "MoveExecuted");

    // 이후 OmnibusVault 잔액 증가 확인(원하면 추가 검증)
    // expect(await ethers.provider.getBalance(await vault.getAddress())).to.eq(ethers.parseEther("0.2"));
  });
});
