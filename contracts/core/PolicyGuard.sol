// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

library Types {
    struct DailyLimit {
        uint256 max;     // 일일 한도
        uint256 spent;   // 오늘 사용량
        uint64  dayKey;  // floor(block.timestamp / 86400)
    }
}

/**
 * @title PolicyGuard
 * @notice ETH Only 정책 가드: Per-user WL + Per-user Daily Limit(+옵션 Global Cap)
 */
contract PolicyGuard is Ownable {
    // userKey => (to => allowed)
    mapping(bytes32 => mapping(address => bool)) public userWL;
    // userKey => Daily
    mapping(bytes32 => Types.DailyLimit) public userDailyETH;
    // 0이면 미사용. >0 이면 출금 1회 글로벌 상한
    uint256 public maxCapETH;

    event UserWLUpdated(bytes32 indexed userKey, address indexed to, bool allowed);
    event UserDailyLimitUpdated(bytes32 indexed userKey, uint256 max);
    event MaxCapUpdated(uint256 cap);

    // ───── 커스텀 에러(테스트에서는 generic revert로 검증해도 OK)
    error TOKEN_NOT_ALLOWED();   // token != address(0)
    error WL_FORBIDDEN();        // WL 미포함
    error OVER_GLOBAL_CAP();     // maxCapETH 초과
    error OVER_DAILY_LIMIT();    // 일일 한도 초과

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─────────────────────────────────────────────────────────────
    // 관리 함수
    function setUserWL(bytes32 userKey, address to) external onlyOwner {
        userWL[userKey][to] = true;
        emit UserWLUpdated(userKey, to, true);
    }

    function unsetUserWL(bytes32 userKey, address to) external onlyOwner {
        userWL[userKey][to] = false;
        emit UserWLUpdated(userKey, to, false);
    }

    function setUserDailyLimit(bytes32 userKey, uint256 max) external onlyOwner {
        userDailyETH[userKey].max = max;
        emit UserDailyLimitUpdated(userKey, max);
    }

    function setMaxCapETH(uint256 cap) external onlyOwner {
        maxCapETH = cap;
        emit MaxCapUpdated(cap);
    }

    // ─────────────────────────────────────────────────────────────
    // 조회용: 상태 변경 X
    function checkView(
        address to,
        address token,
        uint256 amount,
        bytes32 userKey
    ) external view returns (bool) {
        if (token != address(0)) return false;                 // ETH Only
        if (!userWL[userKey][to]) return false;                // WL 필수
        if (maxCapETH > 0 && amount > maxCapETH) return false; // 글로벌 캡

        Types.DailyLimit memory d = userDailyETH[userKey];
        uint64 today = uint64(block.timestamp / 86400);
        uint256 spent = (d.dayKey == today) ? d.spent : 0;

        if (d.max == 0) return false;                          // 한도 미설정은 차단
        if (spent + amount > d.max) return false;              // 일일 한도

        return true;
    }

    // 실행용: 카운터 증가. 실패 시 커스텀 에러로 revert
    function check(
        address to,
        address token,
        uint256 amount,
        bytes32 userKey
    ) external returns (bool) {
        if (token != address(0)) revert TOKEN_NOT_ALLOWED();   // ETH Only
        if (!userWL[userKey][to]) revert WL_FORBIDDEN();       // WL 필수
        if (maxCapETH > 0 && amount > maxCapETH) revert OVER_GLOBAL_CAP();

        Types.DailyLimit storage d = userDailyETH[userKey];
        uint64 today = uint64(block.timestamp / 86400);
        if (d.dayKey != today) { d.dayKey = today; d.spent = 0; }

        // 일일 한도 미설정(=0) 또는 초과 시 거부
        if (d.max == 0 || d.spent + amount > d.max) revert OVER_DAILY_LIMIT();

        d.spent += amount; // 승인 시 증가
        return true;
    }
}
