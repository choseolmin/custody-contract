// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IPolicyGuard {
    function setUserWL(bytes32 userKey, address to) external;
    function unsetUserWL(bytes32 userKey, address to) external;
    function setUserDailyLimit(bytes32 userKey, uint256 max) external;

    function setMaxCapETH(uint256 cap) external;
    /// @notice 실행 시점 강제 체크 (카운터 증가)
    function check(address to, address token, uint256 amount, bytes32 userKey) external returns (bool);

    /// @notice UX용 사전 확인 (상태 변화 없음)
    function checkView(address to, address token, uint256 amount, bytes32 userKey) external view returns (bool);
}
