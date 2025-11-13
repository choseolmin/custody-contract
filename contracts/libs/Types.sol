// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library Types {
    struct DailyLimit {
        uint256 max;    // 일일 한도 (Wei)
        uint256 spent;  // 해당 UTC 일자 사용량 (Wei)
        uint64  dayKey; // floor(block.timestamp / 86400)
    }
}
