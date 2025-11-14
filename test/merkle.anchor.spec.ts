import { expect } from "chai";
import { ethers } from "hardhat";
import { MerkleAnchor } from "../typechain-types";

describe("MerkleAnchor", () => {
  async function deploy() {
    const [owner] = await ethers.getSigners();
    const F = await ethers.getContractFactory("MerkleAnchor");
    const anchor = (await F.deploy(await owner.getAddress())) as MerkleAnchor;
    await anchor.waitForDeployment();
    return { owner, anchor };
  }

  it("anchor: 정상 저장 + latestAnchor/getRoot 동작", async () => {
    const { anchor } = await deploy();

    const periodKey = 1n; // uint64
    const root = ethers.keccak256(ethers.toUtf8Bytes("period-1-root"));

    const tx = await anchor.anchor(root, periodKey);
    await expect(tx)
      .to.emit(anchor, "Anchored")
      .withArgs(periodKey, root);

    const stored = await anchor.getRoot(periodKey);
    expect(stored).to.equal(root);

    const latest = await anchor.latestAnchor();
    expect(latest[0]).to.equal(periodKey);
    expect(latest[1]).to.equal(root);
  });

  it("RootIsZero: merkleRoot가 0이면 리버트", async () => {
    const { anchor } = await deploy();

    await expect(
      anchor.anchor(ethers.ZeroHash, 1n)
    ).to.be.revertedWithCustomError(anchor, "RootIsZero");
  });

  it("PeriodAlreadyAnchored: 같은 periodKey에 다른 root 넣으면 리버트", async () => {
    const { anchor } = await deploy();

    const periodKey = 10n;
    const root1 = ethers.keccak256(ethers.toUtf8Bytes("r1"));
    const root2 = ethers.keccak256(ethers.toUtf8Bytes("r2"));

    await (await anchor.anchor(root1, periodKey)).wait();

    // 같은 root로 다시 anchor → OK
    await (await anchor.anchor(root1, periodKey)).wait();

    // 다른 root로 anchor → 리버트
    await expect(
      anchor.anchor(root2, periodKey)
    ).to.be.revertedWithCustomError(anchor, "PeriodAlreadyAnchored");
  });

  it("RootNotFound: 없는 periodKey에서 getRoot/verifyLeaf 리버트", async () => {
    const { anchor } = await deploy();

    await expect(anchor.getRoot(123n)).to.be.revertedWithCustomError(
      anchor,
      "RootNotFound"
    );

    const leaf = ethers.keccak256(ethers.toUtf8Bytes("dummy"));
    await expect(
      anchor.verifyLeaf(123n, leaf, [])
    ).to.be.revertedWithCustomError(anchor, "RootNotFound");
  });

  it("verifyLeaf: 단일 리프 머클트리(root=leaf, proof=[]) 검증", async () => {
    const { anchor } = await deploy();

    const periodKey = 5n;
    const leaf = ethers.keccak256(ethers.toUtf8Bytes("only-leaf"));

    // 단일 리프인 경우 머클 루트 == leaf
    await (await anchor.anchor(leaf, periodKey)).wait();

    const ok = await anchor.verifyLeaf(periodKey, leaf, []);
    expect(ok).to.eq(true);

    // 다른 leaf는 false
    const badLeaf = ethers.keccak256(ethers.toUtf8Bytes("other"));
    const bad = await anchor.verifyLeaf(periodKey, badLeaf, []);
    expect(bad).to.eq(false);
  });
});
