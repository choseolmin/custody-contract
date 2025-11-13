import { expect } from "chai";
import { ethers } from "hardhat";

describe("PolicyGuard: WL & DailyLimit", () => {
  it("WL set/unset + check/checkView 동작", async () => {
    const [owner, to] = await ethers.getSigners();

    const P = await ethers.getContractFactory("PolicyGuard");
    const policy = await P.deploy(await owner.getAddress());
    await policy.waitForDeployment();

    const userKey = ethers.encodeBytes32String("u1");
    await (await policy.setUserDailyLimit(userKey, ethers.parseEther("1"))).wait();

    // 초기엔 WL 없음 → checkView false
    let ok = await policy.checkView(
      await to.getAddress(),
      ethers.ZeroAddress,
      ethers.parseEther("0.2"),
      userKey
    );
    expect(ok).to.eq(false);

    // WL 셋 → checkView true
    await (await policy.setUserWL(userKey, await to.getAddress())).wait();
    ok = await policy.checkView(
      await to.getAddress(),
      ethers.ZeroAddress,
      ethers.parseEther("0.2"),
      userKey
    );
    expect(ok).to.eq(true);

    // check(실행용, 카운트 증가) 호출 시 spent 증가
    await (await policy.check(
      await to.getAddress(),
      ethers.ZeroAddress,
      ethers.parseEther("0.2"),
      userKey
    )).wait();

    // 남은 한도 0.8 ETH → 1.0 요청은 OVER_DAILY_LIMIT 커스텀 에러로 리버트
    await expect(
      policy.check(
        await to.getAddress(),
        ethers.ZeroAddress,
        ethers.parseEther("1.0"),
        userKey
      )
    ).to.be.revertedWithCustomError(policy, "OVER_DAILY_LIMIT");
  });
});
