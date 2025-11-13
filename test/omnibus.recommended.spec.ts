import { expect } from "chai";
import { ethers, network } from "hardhat";

describe("Omnibus + PolicyGuard — recommended edge tests", () => {
  const TH = ethers.parseEther("0.01");

  async function deployAll() {
    const [owner, tss, manager, user, to, stranger, newTss] = await ethers.getSigners();

    const Policy = await ethers.getContractFactory("PolicyGuard");
    const policy = await Policy.deploy(await owner.getAddress());
    await policy.waitForDeployment();

    const Vault = await ethers.getContractFactory("OmnibusVault");
    const vault = await Vault.deploy(await owner.getAddress(), await policy.getAddress());
    await vault.waitForDeployment();

    // 좌석 연결
    await (await vault.setTss(await tss.getAddress())).wait();
    await (await vault.grantManager(await manager.getAddress(), true)).wait();

    // 사용자 키/정책
    const userKey = ethers.encodeBytes32String("user-1");
    await (await policy.setUserWL(userKey, await to.getAddress())).wait();
    await (await policy.setUserDailyLimit(userKey, ethers.parseEther("10"))).wait();

    // 예치 (user EOA로)
    await (await vault.connect(user).depositETH(userKey, { value: ethers.parseEther("2") })).wait();

    return { owner, tss, manager, user, to, stranger, newTss, policy, vault, userKey };
  }

  it("WL unset 이후 즉시 차단", async () => {
    const { tss, manager, to, policy, vault, userKey } = await deployAll();

    const amt = ethers.parseEther("0.02");
    // 1) 성공 케이스
    const id1 = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();
    await (await vault.connect(tss).approveTx(id1)).wait();
    await (await vault.connect(manager).approveTx(id1)).wait();
    await expect(vault.execute(id1, TH)).to.emit(vault, "Executed");

    // 2) WL 해제 후 동일 수신자 출금 → PolicyGuard.WL_FORBIDDEN()으로 revert
    await (await policy.unsetUserWL(userKey, await to.getAddress())).wait();

    const id2 = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();
    await (await vault.connect(tss).approveTx(id2)).wait();
    await (await vault.connect(manager).approveTx(id2)).wait();

    await expect(vault.execute(id2, TH))
      .to.be.revertedWithCustomError(policy, "WL_FORBIDDEN");
  });

  it("일일 한도 롤오버(UTC dayKey) 동작", async () => {
    const { tss, manager, to, policy, vault, userKey } = await deployAll();

    // 하루 한도 1 ETH
    await (await policy.setUserDailyLimit(userKey, ethers.parseEther("1"))).wait();

    // 같은 날 1 ETH → OK
    const id1 = await vault.submitTx.staticCall(await to.getAddress(), ethers.parseEther("1"), userKey);
    await (await vault.submitTx(await to.getAddress(), ethers.parseEther("1"), userKey)).wait();
    await (await vault.connect(tss).approveTx(id1)).wait();
    await (await vault.connect(manager).approveTx(id1)).wait();
    await expect(vault.execute(id1, TH)).to.emit(vault, "Executed");

    // 같은 날 추가 0.1 ETH → PolicyGuard.OVER_DAILY_LIMIT()으로 revert
    const id2 = await vault.submitTx.staticCall(await to.getAddress(), ethers.parseEther("0.1"), userKey);
    await (await vault.submitTx(await to.getAddress(), ethers.parseEther("0.1"), userKey)).wait();
    await (await vault.connect(tss).approveTx(id2)).wait();
    await (await vault.connect(manager).approveTx(id2)).wait();
    await expect(vault.execute(id2, TH))
      .to.be.revertedWithCustomError(policy, "OVER_DAILY_LIMIT");

    // 다음날로 이동
    const block = await ethers.provider.getBlock("latest");
    await network.provider.send("evm_setNextBlockTimestamp", [Number(block!.timestamp) + 86400]);
    await network.provider.send("evm_mine");

    // 다음날 0.1 ETH → OK
    const id3 = await vault.submitTx.staticCall(await to.getAddress(), ethers.parseEther("0.1"), userKey);
    await (await vault.submitTx(await to.getAddress(), ethers.parseEther("0.1"), userKey)).wait();
    await (await vault.connect(tss).approveTx(id3)).wait();
    await (await vault.connect(manager).approveTx(id3)).wait();
    await expect(vault.execute(id3, TH)).to.emit(vault, "Executed");
  });

  it("MaxCap(옵션) 초과는 POLICY로 거부", async () => {
    const { tss, manager, to, policy, vault, userKey } = await deployAll();

    // MaxCap = 0.05 ETH
    await (await policy.setMaxCapETH(ethers.parseEther("0.05"))).wait();

    const amt = ethers.parseEther("0.06");
    const id = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();
    await (await vault.connect(tss).approveTx(id)).wait();
    await (await vault.connect(manager).approveTx(id)).wait();

    // PolicyGuard.OVER_GLOBAL_CAP()으로 revert
    await expect(vault.execute(id, TH))
      .to.be.revertedWithCustomError(policy, "OVER_GLOBAL_CAP");
  });

  it("txId는 nonce 포함으로 유일(충돌 방지)", async () => {
    const { tss, manager, to, vault, userKey } = await deployAll();

    const amt = ethers.parseEther("0.02");
    const id1 = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();

    const id2 = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();

    expect(id1).to.not.equal(id2);

    await (await vault.connect(tss).approveTx(id1)).wait();
    await (await vault.connect(manager).approveTx(id1)).wait();
    await expect(vault.execute(id1, TH)).to.emit(vault, "Executed");
  });

  it("Approved 이벤트와 내부 플래그(TSS/Manager) 정확성", async () => {
    const { tss, manager, to, vault, userKey } = await deployAll();

    const amt = ethers.parseEther("0.2");
    const id = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();

    await expect(vault.connect(tss).approveTx(id))
      .to.emit(vault, "Approved")
      .withArgs(id, await tss.getAddress());

    await expect(vault.connect(manager).approveTx(id))
      .to.emit(vault, "Approved")
      .withArgs(id, await manager.getAddress());

    // 실행되면 내부 executed=true
    await expect(vault.execute(id, TH)).to.emit(vault, "Executed");
    const tx = await vault.txs(id);
    expect(tx.executed).to.eq(true);
    expect(tx.approvedTss).to.eq(true);
    expect(tx.approvedManager).to.eq(true);
  });

  it("Manager 권한 회수 후 승인 불가", async () => {
    const { tss, manager, to, vault, userKey } = await deployAll();

    const amt = ethers.parseEther("0.2");
    const id = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();
    await (await vault.connect(tss).approveTx(id)).wait();

    // 권한 제거
    await (await vault.grantManager(await manager.getAddress(), false)).wait();

    // 더 이상 Manager 승인은 불가
    await expect(vault.connect(manager).approveTx(id)).to.be.revertedWith("NEED_TSS_OR_MANAGER");
  });

  it("TSS 교체 후 기존 TSS는 승인 불가 / 새 TSS는 가능", async () => {
    const { tss, newTss, manager, to, vault, userKey } = await deployAll();

    const amt = ethers.parseEther("0.2");
    const id = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();

    // TSS 교체
    await (await vault.setTss(await newTss.getAddress())).wait();

    await expect(vault.connect(tss).approveTx(id)).to.be.revertedWith("NEED_TSS_OR_MANAGER");
    await expect(vault.connect(newTss).approveTx(id)).to.emit(vault, "Approved");

    await (await vault.connect(manager).approveTx(id)).wait();
    await expect(vault.execute(id, TH)).to.emit(vault, "Executed");
  });

  it("receive/fallback 직접 송금 거부", async () => {
    const { owner, vault } = await deployAll();
    await expect(
      owner.sendTransaction({ to: await vault.getAddress(), value: 1n })
    ).to.be.reverted; // revert("DIRECT_ETH_REJECTED")
  });

  it("onlyOwner 가드(비-오너 호출 리버트)", async () => {
    const { tss, manager, to, user, vault, userKey } = await deployAll();

    await expect(vault.connect(user).submitTx(await to.getAddress(), 1, userKey)).to.be.reverted;
    await expect(vault.connect(tss).pause(true)).to.be.reverted;
    await expect(vault.connect(manager).setPolicyGuard(ethers.ZeroAddress)).to.be.reverted;
  });

  it("임계값 파라미터 변화에 따라 고액/소액 판정이 달라짐", async () => {
    const { tss, manager, to, vault, userKey } = await deployAll();

    const amt = ethers.parseEther("0.02"); // 0.02 ETH
    const id = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();

    // case1) TH=0.01 → 고액 → TSS+Manager 필요
    await (await vault.connect(tss).approveTx(id)).wait();
    await expect(vault.execute(id, ethers.parseEther("0.01"))).to.be.revertedWithCustomError(
      vault,
      "NotExecutable"
    );

    await (await vault.connect(manager).approveTx(id)).wait();
    await expect(vault.execute(id, ethers.parseEther("0.01"))).to.emit(vault, "Executed");

    // case2) 같은 금액, TH=0.05 → 소액 판정 → TSS만으로 충분 (새 tx로)
    const id2 = await vault.submitTx.staticCall(await to.getAddress(), amt, userKey);
    await (await vault.submitTx(await to.getAddress(), amt, userKey)).wait();
    await (await vault.connect(tss).approveTx(id2)).wait();
    await expect(vault.execute(id2, ethers.parseEther("0.05"))).to.emit(vault, "Executed");
  });
});
