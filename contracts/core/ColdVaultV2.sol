// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdminSeats} from "./base/AdminSeats.sol";

/**
 * @title ColdVault
 * @notice
 *  - 보관 전용. 관리자 2/2 승인 후, 오직 OmnibusVault로만 이동.
 *  - ETH Only
 *  - 입금 경로:
 *      1) adminDeposit(): Owner/Manager EOA가 직접 입금 (운영/테스트용)
 *      2) OmnibusVault.execute() 에서 to=coldVault 로 ETH 송금
 *         → receive()에서 msg.sender == omnibusVault 인 경우 허용
 *      3) Manager EOA가 콜드볼트 주소로 직접 ETH 전송
 *         → receive()에서 isManager(msg.sender) 인 경우 허용
 *  - 출금 경로:
 *      - executeMove()로만 콜드 → OmnibusVault 이동
 *
 * 변경점 (v2 개념):
 *  - adminDeposit / pause / setOmnibusVault / setColdAdmins / executeMove
 *    권한을 onlyOwner → onlyManagerOrOwner 로 완화
 *  - receive()를 수정하여:
 *      - omnibusVault에서 오는 ETH
 *      - manager 주소에서 오는 ETH
 *    두 가지 만 허용
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

    // ─────────────────────────────
    // ETH 수신: 옴니버스 or Manager EOA만 허용
    // ─────────────────────────────

    /**
     * @dev 허용 케이스:
     *  - msg.sender == omnibusVault (옴니 → 콜드 리밸런싱)
     *  - isManager(msg.sender) == true (매니저 지갑에서 직접 입금)
     *
     *  그 외 주소에서 보내는 ETH는 DirectEthRejected().
     */
    receive() external payable {
        if (msg.sender != omnibusVault && !isManager(msg.sender)) {
            revert DirectEthRejected();
        }
        if (msg.value == 0) revert ZeroAmount();
        // no-op: 잔액만 적립
    }

    /// @dev 임의 data를 포함한 call은 허용하지 않음
    fallback() external payable {
        revert DirectEthRejected();
    }

    // 오너/매니저 전용 입금 함수(운영/테스트용). receive를 열지 않기 위해 별도 제공.
    function adminDeposit() external payable onlyManagerOrOwner {
        if (msg.value == 0) revert ZeroAmount();
        // no-op: 잔액만 적립
    }

    // --- 공통 가드 ---
    modifier notPaused() {
        if (paused) revert PausedError();
        _;
    }

    // pause 권한: Owner + Manager
    function pause(bool v) external onlyManagerOrOwner {
        paused = v;
        emit Paused(v);
    }

    // --- 관리자/연결 설정 ---
    /// @notice OmnibusVault 주소 연결(운영: Owner + Manager)
    function setOmnibusVault(address v) external onlyManagerOrOwner {
        omnibusVault = v;
    }

    /// @notice ColdVault 전용 관리자 두 명 설정(반드시 서로 다른 non-zero)
    /// @dev 이제 Owner + Manager 모두 설정 가능
    function setColdAdmins(address _a1, address _a2) external onlyManagerOrOwner {
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
   /// @notice 이동 요청(관리자 or Owner) — 콜드 → 옴니로 보낼 양을 예약
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

    /// @notice 실행(2/2 충족 + Omnibus 설정 필수).
    /// @dev Owner + Manager 모두 실행 가능.
    ///      콜드 → OmnibusVault로 ETH 이동.
    function executeMove(bytes32 moveId) external onlyManagerOrOwner notPaused {
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
