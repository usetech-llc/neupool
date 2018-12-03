pragma solidity 0.4.25;

struct Contribution {

    // Amount of contribution currency received from contributor
    uint96 AmountReceived;

    // Reward is claimed flag
    bool RewardClaimed;

    // Amount is refunded flag
    bool Refunded;
}
