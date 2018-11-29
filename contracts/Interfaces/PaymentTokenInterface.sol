pragma solidity 0.4.25;

contract PaymentTokenInterface {
    function deposit() public payable;
    function withdraw(uint256 amount) public;
    function transfer(address to, uint256 amount, bytes data) public returns (bool);
}
