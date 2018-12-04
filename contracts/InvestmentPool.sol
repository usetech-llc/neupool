pragma solidity 0.4.25;
import './Owned.sol';
import './Dto/Contribution.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Standards/IERC223Callback.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/ETO/IETOCommitment.sol'
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Universe.sol'
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Math.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Neumark.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Company/EquityToken.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/PaymentTokens/EuroToken.sol';
import 'https://github.com/Neufund/platform-contracts/blob/force_eto/contracts/Identity/IIdentityRegistry.sol';

contract InvestmentPool is
    Owned,
    IERC223Callback,
    Math
{
    /* All contributions and rewards */
    mapping (address => Contribution) private _contributions;
    address[] private _batchContributors;
    uint256 private _totalContribution;
    uint256 private _uncommittedContribution;
    uint256 private _totalNeuReward;
    uint256 private _totalEquityReward;
    uint256 private _totalCommission;

    /* Investment Pool Parameters */
    uint256 public MinimumCap = 10**20; // 100 tokens
    address private _neuFundUniverse;
    address private _etoAddress;
    address private _contributionTokenAddress;
    address private _neumarkTokenAddress;
    address private _equityTokenAddress;
    address private _commissionBeneficiary;
    uint16 private _commissionRatePromille = 50;

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
        // 3. In case of refund: From token, which ETO accepts. Funds will come from ETO address.

        bool contributionToken = _contributionTokenAddress == msg.sender;
        bool equityToken = _equityTokenAddress == msg.sender;
        bool neumarkToken = _neumarkTokenAddress == msg.sender;
        require(neumarkToken || equityToken || contributionToken);

        // We received either contribution or refund
        if (contributionToken)
        {
            // This is a contribution
            if (wallet != _etoAddress)
            {
                // ETO should be in Public stage
                require(isContributionAllowed());

                // Input validation
                require(amount < 2 ** 90);

                // Enforce minimum cap
                require(amount >= MinimumCap);

                // Check that investor passed KYC
                IIdentityRegistry ir = _neuFundUniverse.identityRegistry();
                IdentityClaims memory investorStatus = ir.deserializeClaims(ir.getClaims(wallet));
                require(investorStatus.isVerified && !investorStatus.accountFrozen);

                // Calculate and validate resulting amount
                // wallet is investor address
                Contribution storage cont = _contributions[wallet];
                uint256 newAmount = cont.AmountReceived + amount;
                require(newAmount < 2 ** 90);

                // Update contribution
                _batchContributors.push(wallet);
                _totalContribution += amount;
                _uncommittedContribution += amount;
                cont.AmountReceived = newAmount;
            }

            // This is a refund from ETO, just accept balance and do nothing
            //else {}
        }

        // We received reward from ETO
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

        // Mark all batch contributos as committed and clear batch contributors
        // Contributos may appear multiple times in _batchContributors, and that's
        // OK because we only mark funds as committed, without adding balances.
        uint64 batchCount = _batchContributors.length;
        for (uint64 i=0; i<batchCount; i++)
        {
            Contribution storage cont = _contributions[_batchContributors[i]];
            cont.AmountCommitted = cont.AmountReceived;
        }
        delete _batchContributors;

        // Send funds to ETO
        EuroToken paymentToken = EuroToken(_contributionTokenAddress);
        require(paymentToken.transfer(_etoAddress, _uncommittedContribution, ""));
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

    /**
    *  Method for claiming rewards by contributor
    *
    *  Can only be executed after rewards have been claimed by this IP contract
    *  so funds are available. The available balances are not checked because
    *  we rely on NeuFund's code to calculate proportion.
    *
    *  RewardClaimed flag is set before any token transfers to prevent out of
    *  gas attack.
    */
    function claimRewards()
        public
    {
        // Rewards should have been already claimed by IP from ETO
        require(_claimedRewards);

        // Calculate reward amounts
        Contribution storage cont = _contributions[msg.sender];
        uint256 nmkReward = proportion(_totalNeuReward, cont.AmountCommitted, _totalContribution);
        uint256 equityReward = proportion(_totalEquityReward, cont.AmountCommitted, _totalContribution);

        // Transfer rewards
        require(!cont.RewardClaimed); // Prevent double claims
        cont.RewardClaimed = true;

        Neumark neumarkToken = Neumark(_neumarkTokenAddress);
        EquityToken equityToken = EquityToken(_equityTokenAddress);

        neumarkToken.distribute(msg.sender, nmkReward);
        equityToken.distributeTokens(msg.sender, equityReward);
    }

    /**
    *  Method for claiming refunds
    *
    *  Can run in two cases:
    *    1. If ETO is in Refund state.
    *
    *       Refund must be first claimed by IP contract from ETO contract. Because
    *       Refund is a terminal state, there is no better way to ensure that
    *       funds are available for refund than to claim a refund in case if it has
    *       not been claimed. The _claimedRefund flag is only set after a successful
    *       refund.
    *
    *       IP commission amount is reset because once ETO is in Refund state,
    *       it means that ETO has failed.
    *
    *    2. If ETO is in Claim or Payout state and there is a partial
    *       batch that has not been committed to ETO, which is subject to refund.
    *
    *
    *  In either case Refunded flag is set before actual transfers to prevent
    *  out of gas attack
    *
    */
    function claimRefund()
        public
    {
        // ETO is in Refund state
        IETOCommitment etoObject = IETOCommitment(_etoAddress);
        bool refundState = etoObject.state() == IETOCommitment.ETOState.Refund;

        // ETO is past Signing state
        bool pastSigning = (etoObject.state() == IETOCommitment.ETOState.Claim) ||
            (etoObject.state() == IETOCommitment.ETOState.Payout)

        require(refundState || pastSigning);

        // Calculate refund amount
        Contribution storage cont = _contributions[msg.sender];
        require(!cont.Refunded); // Prevent double refunds
        cont.Refunded = true;
        uint96 refundAmount = 0;
        if (refundState)
        {
            // Claim refund from ETO if not yet claimed
            if (!_claimedRefund)
            {
                require(etoObject.refund());
                _claimedRefund = true;
            }

            // Set total commission to 0 because there will be no commission
            _totalCommission = 0;

            // This is a full refund
            refundAmount = cont.AmountReceived;
        }
        else if (pastSigning)
        {
            // This is a partial refund
            refundAmount = cont.AmountReceived - cont.AmountCommitted;
        }

        // Send refund to this investor
        if (refundAmount > 0)
        {
            EuroToken paymentToken = EuroToken(_contributionTokenAddress);
            paymentToken.transfer(msg.sender, (uint256)refundAmount, "");
        }
    }

    function setCommissionBeneficiary(address newBeneficiary)
        external
        onlyOwner
    {
        require(newBeneficiary != address(0));
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
        paymentToken.transfer(_commissionBeneficiary, _totalCommission, "");
    }
}
