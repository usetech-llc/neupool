pragma solidity 0.4.25;
import './Owned.sol';
import './Dto/Contribution.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Standards/IERC223Callback.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/ETO/IETOCommitment.sol'
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Universe.sol'
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Math.sol;
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Neumark.sol;
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Company/EquityToken.sol;
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/PaymentTokens/EuroToken.sol;


contract InvestmentPool is
    Owned,
    IERC223Callback,
    Math
{
    /* All contributions and rewards */
    mapping (address => Contribution) private _contributions;
    uint256 private _totalContribution;
    uint256 private _uncommittedContribution;
    uint256 private _totalNeuReward;
    uint256 private _totalEquityReward;
    uint256 private _totalCommission;

    /* Investment Pool Parameters */
    address private _neuFundUniverse;
    address private _etoAddress;
    address private _contributionTokenAddress;
    address private _neumarkTokenAddress;
    address private _equityTokenAddress;
    address private _commissionBeneficiary;
    uint16 private _commissionRatePromille;

    /* State */
    bool private _claimedRewards;
    bool private _claimedRefund;

    /**
    *  Constructor
    *
    */
    function InvestmentPool(address universeAddr, address etoAddress) public {
        owner = msg.sender;

        _commissionBeneficiary = msg.sender;
        _commissionRatePromille = 50;

        // Universe and ETO address
        _neuFundUniverse = universeAddr;
        _etoAddress = etoAddress;

        // Set token addresses (get from Universe)
        Universe universe = Universe(_neuFundUniverse);
        IETOCommitment etoObject = IETOCommitment(_etoAddress);
        _contributionTokenAddress = address(universe.euroToken());
        _neumarkTokenAddress = address(universe.neumark());
        _equityTokenAddress = address(etoObject.equityToken());
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

    function getSummary()
        public
        view
        returns (
            uint256 totalContribution,
            uint256 uncommittedContribution
        )
    {
        return (
            _totalContribution,
            _uncommittedContribution
        );
    }

    function getContribution()
        public
        view
        returns (
            uint256 amount,
            bool claimed,
            bool refunded
        )
    {
        Contribution storage cont = _contributions[msg.sender];
        return (
            cont.AmountReceived,
            cont.RewardClaimed,
            cont.Refunded
        );
    }

    function isContributionAllowed()
        private
        view
        returns (bool validState)
    {
        IETOCommitment etoObject = IETOCommitment(_etoAddress);
        validState = (etoObject.state() == IETOCommitment.ETOState.Public);
    }

    function tokenFallback(address wallet, uint256 amount, bytes data)
        public
    {
        // We should only receive tokens from valid token addresses.
        // 1. In case of contribution: From token, which ETO accepts and which it uses for defining min/max cap
        // 2. In case of payout: From said above, Equity token, or Neumark

        bool contributionToken = _contributionTokenAddress == msg.sender;
        bool equityToken = _equityTokenAddress == msg.sender;
        bool neumarkToken = _neumarkTokenAddress == msg.sender;
        require(neumarkToken || equityToken || contributionToken);

        // We received contribution
        if (contributionToken)
        {
            // ETO should be in Public stage
            require(isContributionAllowed());

            // Input validation
            require(amount < 2 ** 90);

            // Calculate and validate resulting amount
            // wallet is investor address
            Contribution storage cont = _contributions[wallet];
            uint256 newAmount = cont.AmountReceived + amount;
            require(newAmount < 2 ** 90);

            // Update contribution
            cont.AmountReceived = newAmount;
            _totalContribution += amount;
            _uncommittedContribution += amount;
        }

        // We received reward
        else if (neumarkToken)
        {
            _totalNeuReward += amount;
        }
        else if (equityToken)
        {
            _totalEquityReward += amount;
        }
    }

    function commitFunds()
        external
        onlyOwner
    {
        // Check that ETO is in Public state
        require(isContributionAllowed());

        // Reserve commission
        uint250 commission = proportion(_uncommittedContribution, _commissionRatePromille, 1000);
        _totalCommission += commission;
        _uncommittedContribution -= commission;

        // Send funds to ETO
        EuroToken paymentToken = EuroToken(_contributionTokenAddress);
        bytes data;
        require(paymentToken.transfer(_etoAddress, _uncommittedContribution, data));
        _uncommittedContribution = 0;
    }

    function claimInvestmentPoolReward()
        external
        onlyOwner
    {
        // ETO should be in Claim state
        IETOCommitment etoObject = IETOCommitment(_etoAddress);
        require(etoObject.state() == IETOCommitment.ETOState.Claim);

        // Claim Equity and Neumarks
        etoObject.claim();
        _claimedRewards = true;
    }

    function claimRewards()
        public
    {
        // Rewards should have been already claimed by IP from ETO
        require(_claimedRewards);

        // Calculate reward amounts
        Contribution storage cont = _contributions[msg.sender];
        uint256 nmkReward = proportion(_totalNeuReward, cont.AmountReceived, _totalContribution);
        uint256 equityReward = proportion(_totalEquityReward, cont.AmountReceived, _totalContribution);

        // Transfer rewards
        cont.RewardClaimed = true;
        Neumark neumarkToken = Neumark(_neumarkTokenAddress);
        EquityToken equityToken = EquityToken(_equityTokenAddress);

        neumarkToken.distribute(msg.sender, nmkReward);
        equityToken.distributeTokens(msg.sender, equityReward);
    }

    function claimRefund(address etoAddr)
        public
    {
        // ETO should be in Refund state
        IETOCommitment etoObject = IETOCommitment(_etoAddress);
        require(etoObject.state() == IETOCommitment.ETOState.Refund);

        // Claim refund from ETO if not yet claimed
        if (!_claimedRefund)
        {
            require(etoObject.refund());
            _claimedRefund = true;
        }

        // Set total commission to 0 because there will be no commission
        _totalCommission = 0;

        // Send refund to this investor
        Contribution storage cont = _contributions[msg.sender];
        cont.Refunded = true;
        EuroToken paymentToken = EuroToken(_contributionTokenAddress);
        bytes data;
        paymentToken.transfer(msg.sender, cont.AmountReceived, data);
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

    function setCommissionBeneficiary(address newBeneficiary)
        external
        onlyOwner
    {
        require(newBeneficiary != 0x0);
        _commissionBeneficiary = newBeneficiary;
    }

    function claimCommission()
        external
        onlyOwner
    {
        // ETO should be in Payout state
        IETOCommitment etoObject = IETOCommitment(_etoAddress);
        require(etoObject.state() == IETOCommitment.ETOState.Payout);

        // Send commission to commission beneficiary
        EuroToken paymentToken = EuroToken(_contributionTokenAddress);
        bytes data;
        paymentToken.transfer(_commissionBeneficiary, _totalCommission, data);
    }
}
