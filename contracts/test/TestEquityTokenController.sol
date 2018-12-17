pragma solidity 0.4.25;

import './../../platform-contracts/contracts/Company/PlaceholderEquityTokenController.sol';

contract TestEquityTokenController is
    PlaceholderEquityTokenController
{
    constructor(
        Universe universe,
        address companyLegalRep
    )
        public PlaceholderEquityTokenController(universe, companyLegalRep)
    {
    }

    //
    // Always allow transfers
    //
    function onTransfer(address /*broker*/, address /*from*/, address /*to*/, uint256 /*amount*/)
        public
        constant
        returns (bool allow)
    {
        return true;
    }
}
