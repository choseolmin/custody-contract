// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Admin/Manager unified access base (OZ v5)
/// @notice Admin(=owner): 관리자 추가/삭제 + 모든 기능, Manager: 관리자 관리 제외 모든 기능
abstract contract AdminManagerBase is Ownable2Step, AccessControl {
  bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
  bytes32 public constant TSS_ROLE = keccak256("TSS_ROLE");

  constructor(address initialOwner) Ownable(initialOwner) {
    _grantRole(DEFAULT_ADMIN_ROLE, initialOwner); // AccessControl 관리자
  }

  modifier onlyAdmin() {
    require(msg.sender == owner(), "only admin");
    _;
  }

  modifier onlyManagerOrAdmin() {
    if (msg.sender != owner()) {
      require(hasRole(MANAGER_ROLE, msg.sender), "only manager/admin");
    }
    _;
  }

  // ── Admin 전용: 관리자 추가/삭제 ──────────────────────────
  function grantManager(address account) public onlyAdmin {
    _grantRole(MANAGER_ROLE, account);
  }

  function revokeManager(address account) public onlyAdmin {
    _revokeRole(MANAGER_ROLE, account);
  }

  function grantManagers(address[] calldata accounts) external onlyAdmin {
    for (uint256 i = 0; i < accounts.length; i++) {
      _grantRole(MANAGER_ROLE, accounts[i]);
    }
  }
  function grantTss(address account) public onlyAdmin {
    _grantRole(TSS_ROLE, account);
}
function revokeTss(address account) public onlyAdmin {
    _revokeRole(TSS_ROLE, account);
}
}
