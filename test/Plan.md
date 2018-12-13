Investment Pool Test Plan
=========================


## Contract setup

### Check owner address
### Set commission beneficiary address
### Set commission beneficiary address to 0 (negative test)
### Check minimum cap

## ETO In Progress

### IP only accepts contributions if ETO is in public state
#### Negative test. Send EUR-T to IP while it is in Setup state
#### Negative test. Send EUR-T to IP while it is in Whitelist state
#### Positive test. Send EUR-T to IP while it is in Public state

### Only EUR-T token is accepted as contribution

#### Positive test. Send EUR-T to IP
##### Setup
Approved address
ETO is in Public state

#### Negative test. Send some other ERC223 token to IP (not NEU or Equity)
##### Setup
Approved address
ETO is in Public state

### Only NeuFund approved addresses should be allowed to contribute

#### Positive test. Send EUR-T to IP from approved address
##### Setup
ETO is in Public state

#### Negative test. Send EUR-T to IP from unapproved address
##### Setup
ETO is in Public state

### Only contributions greater or equal to minimum cap are allowed
#### Negative test. Sent EUR-T amount less than IP minimum cap
Verify by calling both getContribution and getSummary methods
#### Positive test. Sent EUR-T amount equal to IP minimum cap
Verify by calling both getContribution and getSummary methods
#### Positive test. Sent EUR-T amount greater than IP minimum cap
Verify by calling both getContribution and getSummary methods

### Cannot contribute more than 2^90

### When batch size is reached, IP Owner should be able to send all received up to date funds to ETO contract
#### Negative test. Commit when ETO is in Setup state
#### Negative test. Commit when ETO is in Whitelist state
#### Positive test. Commit when ETO is in Public state
##### Setup
ETO minimum cap is collected in batch
##### Verify
Correct commission is reserved
Amount less commission is transferred to ETO

### If ETO is ended because maximum cap is reached, and no more contributions are accepted, IP contract should not accept funds
#### Setup
Contribute and commit ETO maximum cap
#### Verify
IP contract does not accept funds anymore

## ETO Success
### IP Contract Claims Rewards
Verify that Neumark and Equity tokens are received and amounts are correct
### Only commission beneficiary can claim commission
#### Negative test. Claim commissions from non-beneficiary address
#### Negative test. Claim commissions while ETO is in Public state
#### Negative test. Claim commissions while ETO is in Claim state
#### Positive test. Claim commissions while ETO is in Payout state

### Equity Tokens and NEU are distributed proportionally between contributors
#### Setup
ETO is successful (Collected above minimum cap contributions, committed, claimed and received rewards from ETO)
Contributions were received from contributors as per table:
| Contributor | Amount |
| 1           | 10000  |
| 2           | 20000  |
| 3           | 70000  |
#### Verify
All three contributors can claim and receive Neu and Equity token proportionally to their contribution.
Contribution claimed flag is set for 1,2,3.

### Negative test. Double claims are prevented.
Contributors cannot claim second and third time.

### There should be a way to return contributions in case if Batch Size is not reached by the end of ETO.
#### Negative test. Claim refund when ETO is in Setup state.
#### Negative test. Claim refund when ETO is in Whitelist state.
#### Negative test. Claim refund when ETO is in Public state.

#### Positive test. Claim refund when ETO is in Claim state. No batches commited.
##### Setup
Less than ETO minimum cap is collected.
Three contributors
##### Verify
Full amount is refunded to all three contributors
Contribution refunded flag is set all three.

#### Positive test. Claim refund when ETO is in Payout state. No batches commited.
Repeat previous test for Claim state refund

#### Positive test. Claim refund when ETO is in Claim state. One batch commited.
##### Setup
First batch collects above minimum cap from contributors 1,2,3 and is committed.
Less than ETO minimum cap is collected in second batch from contributors 3,4,5.
##### Verify
Zero is returned to contributors 1 and 2
Second batch amount is refunded to contributor 3
Full amount is returned to contributors 4 and 5.
Contribution refunded flag is set for 3, 4, 5.

#### Positive test. Claim refund when ETO is in Claim state. Two batches commited.
##### Setup
First batch collects above minimum cap from contributors 1,2,3 and is committed.
Second batch collects above minimum cap from contributors 2,3,4 and is committed.
Less than ETO minimum cap is collected in third batch from contributors 3,4,5.
##### Verify
Zero is returned to contributors 1 and 2
Third batch amount is refunded to contributor 3
Full amount is returned to contributors 4 and 5.
Contribution refunded flag is set for 3, 4, 5.

### Negative test. No double returns.
Same as above, but contributors cannot claim refund second and third time

## ETO Failure
### Positive test. Contributor claims refund from IP.
#### Setup
One batch above ETO minimum cap is collected from contributors 1,2,3 and committed.
ETO Fails
#### Verify
Contributors 1,2,3 can claim refund and receive full amount back
Contribution refunded flag is set for 1,2,3.

### Negative test. Contributors cannot claims refund from IP more than once.
#### Same as previous test, but claim second time
#### Same as previous test, but claim third time

## Reporting
### Contributors can see their contributed balance
### Contributors can see their committed balance
### Totals are reported correctly in getSummary method

## Common tests
### IP rejects ETH on default method
