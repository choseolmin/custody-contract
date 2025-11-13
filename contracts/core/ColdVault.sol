// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdminSeats} from "./base/AdminSeats.sol";

/**
 * @title ColdVault
 * @notice 보관 전용. 관리자 2/2 승인 후, 오직 OmnibusVault로만 이동.
 * - receive/fallback 직접 입금 차단(운영은 adminDeposit()으로만 적립)
 * - 관리자는 setColdAdmins로 두 주소를 등록, 반드시 서로 달라야 함
 */
contract ColdVault is AdminSeats {
    // --- 상태 ---
    address public omnibusVault;
    address public admin1;
    address public admin2;
    bool public paused;
    uint256 public nonce;

    struct Move {
        uint256 amount;
        bool approvedAdmin1;
        bool approvedAdmin2;
        bool executed;
        address approver1;
        address approver2;
    }

    mapping(bytes32 => Move) public moves;

    // --- 이벤트 ---
    event Paused(bool v);
    event MoveRequested(bytes32 indexed moveId, uint256 amount);
    event MoveApproved(bytes32 indexed moveId, address indexed approver);
    event MoveExecuted(bytes32 indexed moveId, uint256 amount);
    event ImbalanceDetected(address vault, uint256 omnibus, uint256 cold, uint256 deviationRay);

    // --- 에러 ---
    error PausedError();
    error AlreadyExecuted();
    error NotExecutable();
    error TransferFailed();
    error DirectEthRejected();
    error BadAdmins();
    error OnlyAdmin1OrAdmin2();
    error DuplicateApprover();
    error OmnibusNotSet();
    error ZeroAmount();

    constructor(address initialOwner) AdminSeats(initialOwner) {}

    // 직접 ETH 전송 금지 (명시적 입금만 허용)
    receive() external payable { revert DirectEthRejected(); }
    fallback() external payable { revert DirectEthRejected(); }

    // 오너 전용 입금 함수(운영/테스트용). receive를 열지 않기 위해 별도 제공.
    function adminDeposit() external payable onlyOwner {
        if (msg.value == 0) revert ZeroAmount();
        // no-op: 잔액만 적립
    }

    // --- 공통 가드 ---
    modifier notPaused() {
        if (paused) revert PausedError();
        _;
    }

    function pause(bool v) external onlyOwner {
        paused = v;
        emit Paused(v);
    }

    // --- 관리자/연결 설정 ---
    /// @notice OmnibusVault 주소 연결(운영 onlyOwner)
    function setOmnibusVault(address v) external onlyOwner {
        omnibusVault = v;
    }

    /// @notice ColdVault 전용 관리자 두 명 설정(반드시 서로 다른 non-zero)
    function setColdAdmins(address _a1, address _a2) external onlyOwner {
        if (_a1 == address(0) || _a2 == address(0) || _a1 == _a2) revert BadAdmins();
        admin1 = _a1;
        admin2 = _a2;
    }

    function _isAdmin(address a) internal view returns (bool) {
        return (a == admin1 || a == admin2);
    }

    // --- Move ID 계산 ---
    function _computeMoveId(uint256 amount, uint256 _nonce) internal pure returns (bytes32) {
        return keccak256(abi.encode(amount, _nonce));
    }

    // --- 워크플로우 ---
    /// @notice 이동 요청(관리자 or Owner)
    function requestMove(uint256 amount) external onlyManagerOrOwner notPaused returns (bytes32 moveId) {
        if (amount == 0) revert ZeroAmount();
        moveId = _computeMoveId(amount, nonce++);
        Move storage m = moves[moveId];
        m.amount = amount;
        emit MoveRequested(moveId, amount);
    }

    /// @notice 관리자 2/2 승인(서로 다른 주소 필수, 오직 admin1/admin2만 허용)
    function approveMove(bytes32 moveId) external notPaused {
        if (!_isAdmin(msg.sender)) revert OnlyAdmin1OrAdmin2();

        Move storage m = moves[moveId];
        if (m.executed) revert AlreadyExecuted();

        if (m.approver1 == address(0)) {
            m.approver1 = msg.sender;
            if (msg.sender == admin1) {
                m.approvedAdmin1 = true;
            } else {
                m.approvedAdmin2 = true;
            }
            emit MoveApproved(moveId, msg.sender);
        } else {
            if (msg.sender == m.approver1) revert DuplicateApprover();
            // 두 번째 승인자
            m.approver2 = msg.sender;
            if (msg.sender == admin1) {
                m.approvedAdmin1 = true;
            } else {
                m.approvedAdmin2 = true;
            }
            emit MoveApproved(moveId, msg.sender);
        }
    }

    /// @notice 실행(2/2 충족 + Omnibus 설정 필수). 운영상 오너 경로로 실행 권장.
    function executeMove(bytes32 moveId) external onlyOwner notPaused {
        Move storage m = moves[moveId];
        if (m.executed) revert AlreadyExecuted();
        if (!(m.approvedAdmin1 && m.approvedAdmin2)) revert NotExecutable();
        if (omnibusVault == address(0)) revert OmnibusNotSet();

        m.executed = true;
        (bool s, ) = payable(omnibusVault).call{value: m.amount}("");
        if (!s) revert TransferFailed();

        emit MoveExecuted(moveId, m.amount);
        _emitImbalance();
    }

    /// @dev Omni/Cold 잔액 편차 10% 이상이면 알림
    function _emitImbalance() internal {
        uint256 Bo = omnibusVault.balance;
        uint256 Bc = address(this).balance;
        if (Bo + Bc == 0) return;
        uint256 devRay = (Bo > Bc ? Bo - Bc : Bc - Bo) * 1e18 / (Bo + Bc);
        if (devRay >= 1e17) { // 10%
            emit ImbalanceDetected(omnibusVault, Bo, Bc, devRay);
        }
    }

    // UX용 헬퍼
    function isExecutableMoveView(bytes32 moveId) external view returns (bool) {
        Move storage m = moves[moveId];
        if (m.executed) return false;
        return (m.approvedAdmin1 && m.approvedAdmin2) && omnibusVault != address(0);
    }
}
