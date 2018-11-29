pragma solidity 0.4.25;

struct Contribution {

    // Ether received from contributor
    uint96 EthReceived;

    // 

    uint96 equivEurUlps;
    // NEU reward issued
    uint96 rewardNmkUlps;
    // Equity Tokens issued, no precision
    uint96 equityTokenInt;
    // total Ether invested
    uint96 amountEth;
    // total Euro invested
    uint96 amountEurUlps;
    // claimed or refunded
    bool claimOrRefundSettled;
    // locked account was used
    bool usedLockedAccount;
    // uint30 reserved // still some bits free
}
