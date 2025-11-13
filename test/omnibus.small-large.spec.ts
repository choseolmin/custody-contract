import { expect } from "chai";
import { ethers } from "hardhat";

describe("OmnibusVault: small vs large threshold approvals", () => {
  it("소액: seatA(TSS)만 승인 → execute OK / 고액: TSS+Manager 둘 다 승인 필요", async () => {
    const [owner, tss, manager, to, depositor] = await ethers.getSigners();

    const P = await ethers.getContractFactory("PolicyGuard");
    const policy = await P.deploy(await owner.getAddress());
    await policy.waitForDeployment();

    const V = await ethers.getContractFactory("OmnibusVault");
    const vault = await V.deploy(await owner.getAddress(), await policy.getAddress());
    await vault.waitForDeployment();

    // 역할
    await (await vault.setTss(await tss.getAddress())).wait();
    await (await vault.grantManager(await manager.getAddress(), true)).wait();

    // 정책 (to를 WL에 추가 + 일일한도 넉넉히)
    const userKey = ethers.encodeBytes32String("user-1");
    await (await policy.setUserWL(userKey, await to.getAddress())).wait();
    await (await policy.setUserDailyLimit(userKey, ethers.parseEther("100"))).wait();

    // 예치 (execute 테스트용 잔액 준비)
    await (await vault.connect(depositor).depositETH(userKey, { value: ethers.parseEther("10") })).wait();

    const TH = ethers.parseEther("0.01"); // 0.01 ETH

    // ── 소액 출금: amount = 0.005 ETH (≤ TH)
    {
      const amount = ethers.parseEther("0.005");
      // submit
      const txId = await vault.submitTx.staticCall(await to.getAddress(), amount, userKey);
      await (await vault.submitTx(await to.getAddress(), amount, userKey)).wait();

      // 승인: TSS만 승인
      await (await vault.connect(tss).approveTx(txId)).wait();

      // 실행: owner가 execute 호출, smallTxThresholdWei = TH
      await expect(vault.execute(txId, TH)).to.emit(vault, "Executed");
    }

    // ── 고액 출금: amount = 0.2 ETH (> TH)
    {
      const amount = ethers.parseEther("0.2");
      const txId = await vault.submitTx.staticCall(await to.getAddress(), amount, userKey);
      await (await vault.submitTx(await to.getAddress(), amount, userKey)).wait();

      // TSS 승인만으로는 실패
      await (await vault.connect(tss).approveTx(txId)).wait();
      await expect(vault.execute(txId, TH)).to.be.revertedWithCustomError(vault, "NotExecutable");

      // Manager 승인까지 하면 성공
      await (await vault.connect(manager).approveTx(txId)).wait();
      await expect(vault.execute(txId, TH)).to.emit(vault, "Executed");
    }
  });
});
