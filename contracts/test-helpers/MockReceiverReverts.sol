// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// 모든 ETH 수신을 거부(revert)해서 Vault.execute의 TransferFailed를 재현하기 위함
contract MockReceiverReverts {
    receive() external payable {
        revert("NOPE");
    }
    fallback() external payable {
        revert("NOPE");
    }
}
