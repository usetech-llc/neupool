pragma solidity 0.4.25;

// Make some imports to cause compiler to produce json files that we use in tests
import './../../platform-contracts/contracts/PaymentTokens/EuroTokenController.sol';
import './../../platform-contracts/contracts/ETO/ETOCommitment.sol';
import './../../platform-contracts/contracts/Company/PlaceholderEquityTokenController.sol';

contract SomeOtherERC223Token
{
    mapping( address => uint256) _balances;

    function setBalance(address addr, uint256 balance)
        public
    {
        _balances[addr] = balance;
    }

    //
    // Mocks IERC223Token for receiving contracts
    //
    function transfer(address to, uint256 amount, bytes data)
        public
        returns (bool success)
    {
        // Notify the receiving contract.
        IERC223Callback(to).tokenFallback(msg.sender, amount, data);
        return true;
    }

    function balanceOf(address addr)
        public
        view
        returns (uint256)
    {
        return _balances[addr];
    }
}
