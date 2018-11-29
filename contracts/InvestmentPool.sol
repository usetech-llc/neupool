pragma solidity 0.4.25;
import './Owned.sol';
import './Dto/Contribution.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Standards/IERC223Callback.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/ETO/IETOCommitment.sol'


contract InvestmentPool is
    Owned,
    IERC223Callback
{
    /* Arrays of all contributions */
    mapping (address => mapping (address => Contribution)) private _contributions;



    /**
    *  Constructor
    *
    *  Initializes contract with initial supply tokens to the creator of the contract
    */
    function InvestmentPool() public {
        owner = msg.sender;
    }

    modifier onlyPayloadSize(uint size) {
        assert(msg.data.length >= size + 4);
        _;
    }

    /**
    *  Default method
    *
    *  This unnamed function is called whenever someone tries to send ether to
    *  it. Transaction needs to be reverted because there is special call to
    *  make contributions.
    *
    *  Missing payable modifier prevents accidental sending of ether
    */
    function() public {
    }


    function isContributionAllowed(address etoAddr)
        private
        view
        returns (bool validState)
    {
        IETOCommitment etoObject = IETOCommitment(etoAddr);
        validState = (etoObject.state() == IETOCommitment.ETOState.Public);
    }

    function contribute(address etoAddr)
        public
        payable
        onlyPayloadSize(32)
    {
        require(isContributionAllowed());
    }

    function tokenFallback(address wallet, uint256 amount, bytes data)
        public
    {
    }

    function claimEtoRewards(address etoAddr)
        public
    {
    }

    function claimRefund(address etoAddr)
        public
    {
    }

    function distributeEtoRewards(address etoAddr, address[] contributorAddresses)
        external
        onlyOwner
    {
    }

    function refundMultiple(address etoAddr, address[] contributorAddresses)
        external
        onlyOwner
    {
    }

}
