// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdminSeats} from "./base/AdminSeats.sol";
import {IPolicyGuard} from "../interfaces/IPolicyGuard.sol";

/**
 * @title OmnibusVaultV2
 * @notice TSS(Seat A) + Manager(Seat B, 고액 시) 2-of-2 승인 구조, ETH 전용
 * @dev V1과의 차이:
 *      - pause / setPolicyGuard / setColdVault / submitTx / execute 에
 *        onlyManagerOrOwner 적용 (운영은 매니저/오너 모두 가능)
 *      - Manager/TSS 추가/삭제 권한은 여전히 AdminSeats.onlyOwner 에만 있음
 */
contract OmnibusVaultV2 is AdminSeats {
    IPolicyGuard public policyGuard;
    bool public paused;
    uint256 public nonce;

    // 🔹 ColdVault 전용 연결(콜드 → 옴니 리밸런싱용)
    address public coldVault;

    struct Tx {
        address to;
        uint256 amount;
        bytes32 userKey;
        bool approvedTss;
        bool approvedManager; // amount > threshold 일 때 필수
        bool executed;
    }

    mapping(bytes32 => Tx) public txs;

    event Paused(bool v);
    event Deposit(bytes32 indexed userKey, address indexed from, address indexed token, uint256 amount);
    event Submitted(bytes32 indexed txId, address indexed to, uint256 amount, bytes32 indexed userKey);
    event Approved(bytes32 indexed txId, address indexed approver);
    event Executed(bytes32 indexed txId);

    error PausedError();
    error AlreadyExecuted();
    error NotExecutable();
    error TransferFailed();
    error OnlyEOA();
    error Insufficient();

    constructor(address initialOwner, address _policyGuard)
        AdminSeats(initialOwner)
    {
        policyGuard = IPolicyGuard(_policyGuard);
    }

    /// @notice ColdVault에서 오는 ETH만 허용, 그 외 직접 송금은 거부
    receive() external payable {
        if (msg.sender != coldVault) {
            revert("DIRECT_ETH_REJECTED");
        }
        // 필요하면 여기서 별도 이벤트를 찍을 수도 있음 (ex. Rebalanced)
    }

    fallback() external payable {
        revert("DIRECT_ETH_REJECTED");
    }

    modifier notPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier onlyEOA() {
        uint32 size;
        address sender = msg.sender;
        assembly {
            size := extcodesize(sender)
        }
        if (size > 0) revert OnlyEOA();
        _;
    }

    // ── 운영 제어
    /// @dev 이제 관리자(Manager)도 pause 가능
    function pause(bool v) external onlyManagerOrOwner {
        paused = v;
        emit Paused(v);
    }

    /// @dev PolicyGuard 주소 교체도 Manager/Owner 모두 가능 (원하면 onlyOwner로 다시 잠글 수도 있음)
    function setPolicyGuard(address _p) external onlyManagerOrOwner {
        policyGuard = IPolicyGuard(_p);
    }

    /// @notice ColdVault 주소 연결 (리밸런싱용), Manager/Owner 모두 가능
    function setColdVault(address v) external onlyManagerOrOwner {
        coldVault = v;
    }

    // ── 입금 (사용자 직접 입금 경로)
    function depositETH(bytes32 userKey)
        external
        payable
        notPaused
        onlyEOA
    {
        if (msg.value == 0) revert Insufficient();
        emit Deposit(userKey, msg.sender, address(0), msg.value);
    }

    // ── txId 계산 (off-chain과 동일 식별)
    function computeTxId(address to, uint256 amount, bytes32 userKey, uint256 _nonce)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(to, amount, userKey, _nonce));
    }

    // ── 출금 플로우
    /// @dev 이제 Manager/Owner 모두 출금 신청 가능
    function submitTx(address to, uint256 amount, bytes32 userKey)
        external
        onlyManagerOrOwner
        notPaused
        returns (bytes32 txId)
    {
        if (address(this).balance < amount) revert Insufficient();
        txId = computeTxId(to, amount, userKey, nonce++);
        Tx storage t = txs[txId];
        t.to = to;
        t.amount = amount;
        t.userKey = userKey;
        emit Submitted(txId, to, amount, userKey);
    }

    function approveTx(bytes32 txId) external notPaused {
        Tx storage t = txs[txId];
        if (t.executed) revert AlreadyExecuted();

        if (isTss(msg.sender)) {
            if (!t.approvedTss) {
                t.approvedTss = true;
                emit Approved(txId, msg.sender);
            }
        } else if (isManager(msg.sender)) {
            if (!t.approvedManager) {
                t.approvedManager = true;
                emit Approved(txId, msg.sender);
            }
        } else {
            revert("NEED_TSS_OR_MANAGER");
        }
    }

    /// @dev 이제 Manager/Owner 모두 execute 가능
    //      (소액: TSS 승인만, 고액: TSS + Manager 승인 필요 로직은 그대로 유지)
    function execute(bytes32 txId, uint256 smallTxThresholdWei)
        external
        onlyManagerOrOwner
        notPaused
    {
        Tx storage t = txs[txId];
        if (t.executed) revert AlreadyExecuted();

        // 승인 조건: seatA(TSS)는 항상 필수, seatB(Manager)는 고액만
        bool needManager = t.amount > smallTxThresholdWei;
        bool ok = t.approvedTss && (!needManager || t.approvedManager);
        if (!ok) revert NotExecutable();

        // 🔹 정책 강제 검사
        policyGuard.check(t.to, address(0), t.amount, t.userKey);

        t.executed = true;
        (bool s, ) = t.to.call{value: t.amount}("");
        if (!s) revert TransferFailed();
        emit Executed(txId);
    }
}
