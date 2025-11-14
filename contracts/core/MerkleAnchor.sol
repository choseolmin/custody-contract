// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";


/**
 * @title MerkleAnchor
 * @notice Off-chain Merkle Root anchoring contract (예: 1시간 단위 periodKey용)
 */

contract MerkleAnchor is Ownable2Step {
    // periodKey(예: floor(ts / 3600)) -> merkleRoot
    mapping(uint64 => bytes32) public roots;
    uint64 public lastPeriodKey;

    event Anchored(uint64 indexed periodKey, bytes32 indexed merkleRoot);

    error RootIsZero();
    error PeriodAlreadyAnchored(bytes32 existing, bytes32 incoming);
    error RootNotFound();

    /// 🔹 여기서 중요한 부분: Ownable(initialOwner)를 호출
    constructor(address initialOwner)
        Ownable(initialOwner) // ✅ 부모 Ownable 생성자에 initialOwner 전달
    {
        // 별도 로직 없어도 됨
    }

    function anchor(bytes32 merkleRoot, uint64 periodKey) external onlyOwner {
        if (merkleRoot == bytes32(0)) revert RootIsZero();

        bytes32 prev = roots[periodKey];
        if (prev != bytes32(0) && prev != merkleRoot) {
            revert PeriodAlreadyAnchored(prev, merkleRoot);
        }

        roots[periodKey] = merkleRoot;
        if (periodKey > lastPeriodKey) {
            lastPeriodKey = periodKey;
        }

        emit Anchored(periodKey, merkleRoot);
    }

    function latestAnchor() external view returns (uint64 pk, bytes32 root) {
        pk = lastPeriodKey;
        root = roots[pk];
    }

    function getRoot(uint64 periodKey) external view returns (bytes32) {
        bytes32 root = roots[periodKey];
        if (root == bytes32(0)) revert RootNotFound();
        return root;
    }

    function verifyLeaf(
        uint64 periodKey,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 root = roots[periodKey];
        if (root == bytes32(0)) revert RootNotFound();
        return MerkleProof.verify(proof, root, leaf);
    }
}
