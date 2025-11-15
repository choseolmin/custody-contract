// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdminSeats} from "./base/AdminSeats.sol";
import {IPolicyGuard} from "../interfaces/IPolicyGuard.sol";

/**
 * @title PolicyGuard (v2)
 * @notice
 * - Owner(배포자): Manager 추가/삭제 + 모든 정책 변경 가능
 * - Manager: 정책 변경 가능(Owner가 grantManager로 권한 부여)
 * - OmnibusVault.execute() 에서 check(...) 를 호출해 최종 출금 검증
 *
 * ETH Only 프로젝트이므로 token 파라미터는 항상 address(0) 으로 가정.
 */
contract PolicyGuard is AdminSeats, IPolicyGuard {
    // ─────────────────────────────
    // Storage
    // ─────────────────────────────

    /// @notice Per-user whitelist: userKey → (to → allowed)
    mapping(bytes32 => mapping(address => bool)) public userWL;

    /// @notice Per-user ETH daily limit (UTC day 기준)
    struct Daily {
        uint256 max;    // 일일 한도 (0이면 무제한)
        uint256 spent;  // 해당 dayKey에서 이미 사용한 양
        uint64  dayKey; // floor(block.timestamp / 86400)
    }

    mapping(bytes32 => Daily) public userDailyETH;

    /// @notice 글로벌 MaxCap (1회 출금 상한, 0이면 미사용)
    uint256 public maxCapETH;

    // ─────────────────────────────
    // Events
    // ─────────────────────────────

    event UserWLUpdated(bytes32 indexed userKey, address indexed to, bool allowed);
    event UserDailyLimitUpdated(bytes32 indexed userKey, uint256 max);
    event MaxCapUpdated(uint256 cap);

    // ─────────────────────────────
    // Custom Errors (정책 위반 사유 구분용)
    // ─────────────────────────────

    error WLForbidden(address to);
    error OverDailyLimit(bytes32 userKey, uint256 max, uint256 spent, uint256 amount);
    error OverGlobalCap(uint256 maxCap, uint256 amount);

    // ─────────────────────────────
    // Constructor
    // ─────────────────────────────

    constructor(address initialOwner) AdminSeats(initialOwner) {}

    // ─────────────────────────────
    // Internal helpers
    // ─────────────────────────────

    function _currentDayKey() internal view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }

    function _rollover(bytes32 userKey) internal {
        Daily storage d = userDailyETH[userKey];
        uint64 today = _currentDayKey();
        if (d.dayKey != today) {
            d.dayKey = today;
            d.spent = 0;
        }
    }

    // ─────────────────────────────
    // Policy 관리 함수 (Owner 또는 Manager 전용)
    // ─────────────────────────────

    /// @notice 출금 가능 주소 추가 (Whitelist ON)
    function setUserWL(bytes32 userKey, address to) external onlyManagerOrOwner {
        userWL[userKey][to] = true;
        emit UserWLUpdated(userKey, to, true);
    }

    /// @notice 출금 가능 주소 제거 (Whitelist OFF)
    function unsetUserWL(bytes32 userKey, address to) external onlyManagerOrOwner {
        userWL[userKey][to] = false;
        emit UserWLUpdated(userKey, to, false);
    }

    /// @notice 해당 userKey의 일일 출금 한도 설정 (0이면 무제한)
    function setUserDailyLimit(bytes32 userKey, uint256 max) external onlyManagerOrOwner {
        Daily storage d = userDailyETH[userKey];
        d.max = max;
        // dayKey, spent는 그대로 두고, 다음 check() 시 rollover 로 리셋 가능
        emit UserDailyLimitUpdated(userKey, max);
    }

    /// @notice 글로벌 1회 출금 상한 설정 (0이면 미사용)
    function setMaxCapETH(uint256 cap) external onlyManagerOrOwner {
        maxCapETH = cap;
        emit MaxCapUpdated(cap);
    }

    // ─────────────────────────────
    // 조회용 (UX, 사전 시뮬레이션)
    // ─────────────────────────────

    /**
     * @notice 사전에 출금 가능 여부를 조회하는 view 함수 (상태 변경 없음)
     * @dev OmnibusVault.execute() 는 이 함수를 쓰지 않고, check(...)를 사용.
     */
    function checkView(
        address to,
        address /* token */,
        uint256 amount,
        bytes32 userKey
    ) external view returns (bool) {
        // 1) WL 검사
        if (!userWL[userKey][to]) {
            return false;
        }

        // 2) Daily Limit (롤오버 고려)
        Daily storage d = userDailyETH[userKey];
        uint64 today = _currentDayKey();
        uint256 spentToday = (d.dayKey == today) ? d.spent : 0;

        if (d.max > 0 && spentToday + amount > d.max) {
            return false;
        }

        // 3) Global MaxCap
        if (maxCapETH > 0 && amount > maxCapETH) {
            return false;
        }

        return true;
    }

    // ─────────────────────────────
    // 실행용 check (OmnibusVault 에서 호출)
    // ─────────────────────────────

    /**
     * @notice 실제 출금 직전에 OmnibusVault.execute() 에서 호출되는 함수
     * @dev
     *  - 조건 위반 시 custom error로 revert
     *  - 통과 시 userDailyETH[userKey].spent 를 증가시키고 true 반환
     */
    function check(
        address to,
        address /* token */,
        uint256 amount,
        bytes32 userKey
    ) external returns (bool) {
        // 1) WL 검사
        if (!userWL[userKey][to]) {
            revert WLForbidden(to);
        }

        // 2) Daily Limit 롤오버 + 사용량 증가 검사
        _rollover(userKey);
        Daily storage d = userDailyETH[userKey];

        if (d.max > 0 && d.spent + amount > d.max) {
            revert OverDailyLimit(userKey, d.max, d.spent, amount);
        }

        // 3) Global MaxCap 검사
        if (maxCapETH > 0 && amount > maxCapETH) {
            revert OverGlobalCap(maxCapETH, amount);
        }

        // 4) 상태 업데이트
        d.spent += amount;

        return true;
    }
}
