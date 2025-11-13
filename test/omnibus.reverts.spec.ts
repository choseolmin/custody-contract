import { expect } from "chai";
import { ethers } from "hardhat";

describe("OmnibusVault: revert paths", () => {
  it("승인 부족/AlreadyExecuted/Insufficient/Paused/TransferFailed 동작 확인", async () => {
    const [owner, tss, manager, to, depositor] = await ethers.getSigners();

    // PolicyGuard 배포 (owner 소유)
    const P = await ethers.getContractFactory("PolicyGuard");
    const policy = await P.deploy(await owner.getAddress());
    await policy.waitForDeployment();

    // Vault 배포 + 좌석 설정
    const V = await ethers.getContractFactory("OmnibusVault");
    const vault = await V.deploy(await owner.getAddress(), await policy.getAddress());
    await vault.waitForDeployment();

    await (await vault.setTss(await tss.getAddress())).wait();
    await (await vault.grantManager(await manager.getAddress(), true)).wait();

    // 기본 WL/한도 설정
    const userKey = ethers.encodeBytes32String("user-1");
    await (await policy.setUserWL(userKey, await to.getAddress())).wait();
    await (await policy.setUserDailyLimit(userKey, ethers.parseEther("100"))).wait();

    // 예치
    await (await vault.connect(depositor).depositETH(userKey, { value: ethers.parseEther("1") })).wait();

    const TH = ethers.parseEther("0.01");

    // -----------------------
    // 1) 승인 부족 → NotExecutable
    // -----------------------
    const amountLarge = ethers.parseEther("0.02"); // 고액(> TH)
    const txId1 = await vault.submitTx.staticCall(await to.getAddress(), amountLarge, userKey);
    await (await vault.submitTx(await to.getAddress(), amountLarge, userKey)).wait();

    // TSS만 승인 → Manager 미승인 상태
    await (await vault.connect(tss).approveTx(txId1)).wait();
    await expect(vault.execute(txId1, TH)).to.be.revertedWithCustomError(vault, "NotExecutable");

    // Manager까지 승인 → 실행 OK
    await (await vault.connect(manager).approveTx(txId1)).wait();
    await expect(vault.execute(txId1, TH)).to.emit(vault, "Executed");

    // 재실행 → AlreadyExecuted
    await expect(vault.execute(txId1, TH)).to.be.revertedWithCustomError(vault, "AlreadyExecuted");

    // -----------------------
    // 2) Insufficient (잔액 부족은 submitTx 단계에서 리버트)
    // -----------------------
    const tooBig = ethers.parseEther("100"); // vault 잔액보다 큼
    await expect(
      vault.submitTx(await to.getAddress(), tooBig, userKey)
    ).to.be.revertedWithCustomError(vault, "Insufficient");

    // -----------------------
    // 3) TransferFailed (수신자가 revert)
    //    - 잔액은 충분하지만 수신 컨트랙트가 수신 거부 → execute에서 TransferFailed
    // -----------------------
    const R = await ethers.getContractFactory("MockReceiverReverts"); // ✅ revert하는 수신 컨트랙트
    const bad = await R.deploy();
    await bad.waitForDeployment();

    // 수신 주소를 WL에 추가 (ETH Only)
    await (await policy.setUserWL(userKey, await bad.getAddress())).wait();

    const amountOk = ethers.parseEther("0.05"); // 잔액 내 금액
    const txId2 = await vault.submitTx.staticCall(await bad.getAddress(), amountOk, userKey);
    await (await vault.submitTx(await bad.getAddress(), amountOk, userKey)).wait();

    // 고액이므로 TSS + Manager 둘 다 승인
    await (await vault.connect(tss).approveTx(txId2)).wait();
    await (await vault.connect(manager).approveTx(txId2)).wait();

    await expect(vault.execute(txId2, TH)).to.be.revertedWithCustomError(vault, "TransferFailed");

    // -----------------------
    // 4) pause → 입금/민감 함수 차단
    // -----------------------
    await (await vault.pause(true)).wait();
    await expect(
      vault.connect(depositor).depositETH(userKey, { value: ethers.parseEther("0.1") })
    ).to.be.revertedWithCustomError(vault, "PausedError");
  });
});
