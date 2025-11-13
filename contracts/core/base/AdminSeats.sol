// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title AdminSeats
 * @notice 공통 관리자/좌석 권한 베이스
 */
abstract contract AdminSeats is Ownable2Step {
    mapping(address => bool) internal _isManager; // Manager 세트
    address public seatATss;                      // TSS 좌석 주소

    event ManagerSet(address indexed manager, bool allowed);
    event TssSet(address indexed tss);

    error NotManager();
    error NotManagerOrOwner();

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyManager() {
        if (!_isManager[msg.sender]) revert NotManager();
        _;
    }

    modifier onlyManagerOrOwner() {
        if (msg.sender != owner() && !_isManager[msg.sender]) {
            revert NotManagerOrOwner();
        }
        _;
    }

    function grantManager(address manager, bool allowed) public onlyOwner {
        _isManager[manager] = allowed;
        emit ManagerSet(manager, allowed);
    }

    function setTss(address tss) public onlyOwner {
        seatATss = tss;
        emit TssSet(tss);
    }

    function isManager(address a) public view returns (bool) {
        return _isManager[a];
    }

    function isTss(address a) public view returns (bool) {
        return a == seatATss;
    }
}
