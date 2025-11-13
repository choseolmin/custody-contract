// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract ForceSend {
    constructor() payable {}
    function boom(address payable to) external {
        selfdestruct(to); // 수신 거부여도 강제로 ETH 전송됨
    }
}
