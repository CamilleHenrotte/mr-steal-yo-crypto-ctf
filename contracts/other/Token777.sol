// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC777/ERC777.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


/// @dev implementation for arbitary tokens
contract Token777 is ERC777, Ownable {

    constructor(
        string memory _name,
        string memory _symbol,
        address[] memory _defaultOperators
    ) ERC777(
        _name,
        _symbol,
        _defaultOperators
    ) {}

    /// @dev mints specified amount for specified users
    function mintPerUser(
        address[] calldata users, 
        uint256[] calldata amounts
    ) external onlyOwner {
        for (uint256 i; i<users.length; ++i) {
            _mint(users[i], amounts[i], "", "");
        }
    }

    /// @dev mints specified amount for user
    function mint(address user, uint256 amount) external onlyOwner {
        _mint(user, amount, "", "");
    }

}