const BigNumber = web3.BigNumber;
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });
const VMException = "VM Exception";
var fs = require('fs');

const chai = require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should();

function toBytes32(hexOrNumber) {
  let strippedHex = "0";
  if (Number.isInteger(hexOrNumber)) {
    strippedHex = hexOrNumber.toString(16);
  } else {
    strippedHex = hexOrNumber.slice(2);
  }
  return `0x${web3.padLeft(strippedHex, 64)}`;
}

async function expectToRevert(errorText, func) {
  try {
    await func();
    throw(Error("Call did not revert"));
  } catch (error) {
    if (!error.toString().includes(errorText))
      throw(error);
  }
}

/**
* Increases ether network time while mining new blocks
*
* @time - time delta to increase network time
*/
async function increaseTime(time) {
  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({
      jsonrpc: "2.0",
      method: "evm_increaseTime",
      params: [time], // 86400 is num seconds in day
      id: new Date().getTime()
    }, (err, result) => {
      if (err) {
        return reject(err)
      }
      return resolve(result)
    });
  })
};

async function mineNewBlock() {
  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0},
      (err, result) => {
        if (err) {
          return reject(err)
        }
        return resolve(result)
      });
  })
};


async function transferToken(tokenObj, fromAddr, toAddr, amount) {
  var senderBalance1 = web3.toBigNumber(await tokenObj.balanceOf(fromAddr));
  var receiverBalance1 = web3.toBigNumber(await tokenObj.balanceOf(toAddr));
  await tokenObj.transfer["address,uint256,bytes"](toAddr, amount, '', {from: fromAddr, gas: 1000000});
  var senderBalance2 = web3.toBigNumber(await tokenObj.balanceOf(fromAddr));
  var receiverBalance2 = web3.toBigNumber(await tokenObj.balanceOf(toAddr));
  senderBalance1.minus(senderBalance2).should.be.bignumber.equal(amount);
  receiverBalance2.minus(receiverBalance1).should.be.bignumber.equal(amount);
}

contract('InvestmentPool', function (accounts) {
  const InvestmentPool = artifacts.require('./../contracts/InvestmentPool.sol');
  const ETO_STATE_SETUP = 0;
  const ETO_STATE_WHITELIST = 1;
  const ETO_STATE_PUBLIC = 2;
  const ETO_STATE_SIGNING = 3;
  const ETO_STATE_CLAIM = 4;
  const ETO_STATE_PAYOUT = 5;
  const ETO_STATE_REFUND = 6;
  let etoStateName = {
    'ETOInSetupState': ETO_STATE_SETUP,
    'ETOInWhitelistState': ETO_STATE_WHITELIST,
    'ETOInPublicState': ETO_STATE_PUBLIC,
    'ETOInSigningState': ETO_STATE_SIGNING,
    'ETOInClaimState': ETO_STATE_CLAIM,
    'ETOInPayoutState': ETO_STATE_PAYOUT,
    'ETOInRefundState': ETO_STATE_REFUND
  };
  const BNTolerance = web3.toBigNumber(0.005);
  const KNOWN_INTERFACE_COMMITMENT = 0xfa0e0c60;
  let etos = {}; // ETOs in all states
  let universeAddr;
  let ips = {}; // IPs with ETOs in all states
  const UniverseContract = artifacts.require('./../platform-contracts/contracts/Universe.sol');
  const EuroTokenContract = artifacts.require('./../platform-contracts/contracts/PaymentTokens/EuroToken.sol');
  const TestTokenController = artifacts.require('./../contracts/test/TestEquityTokenController.sol');
  let universe;
  let neuMark;
  let equityToken;
  let euroToken;
  let eurtDepositManagerAddress;
  let idRegistry;
  let idManagerAddress;
  let tokenController;
  let equityTokenController;
  let testEquityTokenController;
  let etoObj;
  let etoTerms;
  let maxETOTicket;
  let startOfSigning;

  // Monetary constants
  const EUR_1    =        web3.toBigNumber("1000000000000000000");
  const EUR_100  =      web3.toBigNumber("100000000000000000000");
  const EUR_101  =      web3.toBigNumber("101000000000000000000");
  const EUR_100K =   web3.toBigNumber("100000000000000000000000");
  const EUR_300K =   web3.toBigNumber("300000000000000000000000");
  const EUR_1M   =  web3.toBigNumber("1000000000000000000000000");
  const EUR_10M  = web3.toBigNumber("10000000000000000000000000");
  const MinimumCap = EUR_100;
  const InvestorBalance = EUR_10M;

  // Accounts
  const owner = web3.toChecksumAddress(accounts[0]);
  const commissionBeneficiary = web3.toChecksumAddress(accounts[1]);
  const goodInvestors = [
    web3.toChecksumAddress(accounts[2]),
    web3.toChecksumAddress(accounts[4]),
    web3.toChecksumAddress(accounts[5]),
  ];
  const badInvestor = web3.toChecksumAddress(accounts[3]);
  const investments = [
    EUR_1M,
    EUR_100K,
    EUR_100
  ];

  describe('InvestmentPool tests', async () => {
    before(async function () {
      var testNetData = JSON.parse(fs.readFileSync(`${__dirname}/meta.json`, 'utf8'));
      universeAddr = testNetData['UNIVERSE_ADDRESS'];
      //console.log(testNetData['UNIVERSE_ADDRESS']);

      var etosObj = JSON.parse(fs.readFileSync(`${__dirname}/eto_fixtures.json`, 'utf8'));
      for (var address in etosObj) {
        // Assign addresses of ETO in each state
        state = etoStateName[etosObj[address]['name']];
        etos[state] = address;
        //console.log(address, etosObj[address]['name']);

        // Deploy IPs for all ETO states
        ips[state] = await InvestmentPool.new(universeAddr, etos[state]);
      }

      // Get instance of Universe
      const universeJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/Universe.json`, 'utf8'));
      const universeFactory = web3.eth.contract(universeJSON.abi);
      universe = universeFactory.at(universeAddr);

      // Get instance of EuroToken
      const eurtAddress = await universe.euroToken();
      const eurtJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/EuroToken.json`, 'utf8'));
      const eurtFactory = web3.eth.contract(eurtJSON.abi);
      euroToken = eurtFactory.at(eurtAddress);

      // Get instance of NeuMark
      const neuAddress = await universe.neumark();
      const neuJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/Neumark.json`, 'utf8'));
      const neuFactory = web3.eth.contract(neuJSON.abi);
      neuMark = neuFactory.at(neuAddress);

      // Get instance of Identity Registry
      const idRegistryAddress = await universe.identityRegistry();
      const idRegJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/IIdentityRegistry.json`, 'utf8'));
      const idRegFactory = web3.eth.contract(idRegJSON.abi);
      idRegistry = idRegFactory.at(idRegistryAddress);

      // Get Instances of ETO in Public State and ETOTerms
      const etoJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/ETOCommitment.json`, 'utf8'));
      const etoFactory = web3.eth.contract(etoJSON.abi);
      etoObj = etoFactory.at(etos[ETO_STATE_PUBLIC]);
      const etoTermsAddress = await etoObj.etoTerms();
      const etoTermsJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/ETOTerms.json`, 'utf8'));
      const etoTermsFactory = web3.eth.contract(etoTermsJSON.abi);
      etoTerms = etoTermsFactory.at(etoTermsAddress);

      // Get instance of Equity Token
      const etAddress = await etoObj.equityToken();
      const etJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/EquityToken.json`, 'utf8'));
      const etFactory = web3.eth.contract(etJSON.abi);
      equityToken = etFactory.at(etAddress);

      // Get instance of Token Controller
      const tokenControllerAddress = await euroToken.tokenController();
      const tokenControllerJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/EuroTokenController.json`, 'utf8'));
      const tokenControllerFactory = web3.eth.contract(tokenControllerJSON.abi);
      tokenController = tokenControllerFactory.at(tokenControllerAddress);

      // Get instance of Equity Token Controller
      const equityTokenControllerAddress = await equityToken.tokenController();
      const equityTokenControllerJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/PlaceholderEquityTokenController.json`, 'utf8'));
      const equityTokenControllerFactory = web3.eth.contract(equityTokenControllerJSON.abi);
      equityTokenController = equityTokenControllerFactory.at(equityTokenControllerAddress);

      // Register goodInvestors addresses in KYC
      var newClaims = toBytes32("0x7");
      var oldClaims;
      for (var i=0; i<goodInvestors.length; i++) {
        oldClaims = await idRegistry.getClaims(goodInvestors[i]);
        await idRegistry.setClaims(goodInvestors[i], oldClaims, newClaims, {from: owner});
      }

      // Register IP addresses in KYC
      for (var state in ips) {
        oldClaims = await idRegistry.getClaims(ips[state].address);
        await idRegistry.setClaims(ips[state].address, oldClaims, newClaims, {from: owner});
      }

      // Register IP addresses in Universe as ICommitment interface
      for (var state in ips) {
        await universe.setCollectionInterface(KNOWN_INTERFACE_COMMITMENT, ips[state].address, true, {from: owner, gas: 1000000});
      }

      // Allow Transfers to and from goodInvestors
      for (var i=0; i<goodInvestors.length; i++) {
        await tokenController.setAllowedTransferTo(goodInvestors[i], true, {from: owner});
        await tokenController.setAllowedTransferFrom(goodInvestors[i], true, {from: owner});
      }

      // Buy some EUR-T for investors
      for (var i=0; i<goodInvestors.length; i++) {
        var eurtBalance = await euroToken.balanceOf(goodInvestors[i]);
        if (eurtBalance.lt(InvestorBalance)) {
          await euroToken.deposit(goodInvestors[i], InvestorBalance, "", {from: owner});
        }
        //console.log("Funded Investor ", i);
      }

      oldClaims = await idRegistry.getClaims(badInvestor);
      await idRegistry.setClaims(badInvestor, oldClaims, newClaims, {from: owner});
      eurtBalance = (await euroToken.balanceOf(badInvestor)).toNumber();
      if (eurtBalance < InvestorBalance) {
        await euroToken.deposit(badInvestor, InvestorBalance, "", {from: owner});
      }

      // Make this investor BAD (freeze account)
      oldClaims = await idRegistry.getClaims(badInvestor);
      newClaims = toBytes32("0xF");
      await idRegistry.setClaims(badInvestor, oldClaims, newClaims, {from: owner});

      // Allow transfers to and from IPs
      for (var state in ips) {
        await tokenController.setAllowedTransferTo(ips[state].address, true, {from: owner});
      }

      // Get MAX ETO ticket
      maxETOTicket = await etoTerms.MAX_TICKET_EUR_ULPS();
    });

    describe('Pre-condition Tests', async() => {
      it('Universe has been deployed', async () => {
        universeAddr.should.not.equal('undefined');
      });
      it('ETOs in all states have been deployed', async () => {
        var keys = Object.entries(etoStateName).map((kvArr) => kvArr[1]);
        expect(etos).to.contain.keys(keys);
      });
      it('Investors have enough EUR-T Tokens', async () => {
        const eurtGoodBalance = await euroToken.balanceOf(goodInvestors[0]);
        const eurtBadBalance = await euroToken.balanceOf(badInvestor);
        eurtGoodBalance.should.be.bignumber.gte(InvestorBalance);
        eurtBadBalance.should.be.bignumber.gte(InvestorBalance);
      });
    })

    describe('Contract Setup', async() => {
      it('Check Owner Address', async () => {
        const ownerActual = web3.toChecksumAddress(await ips[ETO_STATE_SETUP].owner());
        owner.should.be.equal(ownerActual);
      });
      it('Set Commission Beneficiary', async () => {
        const cbBefore = web3.toChecksumAddress(await ips[ETO_STATE_SETUP].getCommissionBeneficiary());
        await ips[ETO_STATE_SETUP].setCommissionBeneficiary(commissionBeneficiary);
        const cbAfter = web3.toChecksumAddress(await ips[ETO_STATE_SETUP].getCommissionBeneficiary());
        cbBefore.should.be.equal(owner);
        cbAfter.should.be.equal(commissionBeneficiary);
      });
      it('Setting Commission Beneficiary to Zero Should be Rejected', async () => {
        const cbBefore = await ips[ETO_STATE_SETUP].getCommissionBeneficiary();
        await ips[ETO_STATE_SETUP].setCommissionBeneficiary(0)
          .should.be.rejectedWith(VMException);
      });
      it('Minimum cap', async () => {
        const minimumCapActual = (await ips[ETO_STATE_SETUP].MinimumCap()).toNumber();
        minimumCapActual.should.be.bignumber.equal(MinimumCap);
      });
    })

    describe('ETO In Progress', async() => {
      describe('IP only accepts contributions if ETO is in public state', async() => {
        it('Negative test. Send EUR-T to IP while it is in Setup state', async () => {
          await expectToRevert(VMException, async () => {
            await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_SETUP].address, EUR_100);
          });
        });
        it('Negative test. Send EUR-T to IP while it is in Whitelist state', async () => {
          await expectToRevert(VMException, async () => {
            await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_WHITELIST].address, EUR_100);
          });
        });
        it('Positive test. Send EUR-T to IP while it is in Public state', async () => {
          await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PUBLIC].address, EUR_100);
        });
        it('Negative test. Send EUR-T to IP while it is in Signing state', async () => {
          await expectToRevert(VMException, async () => {
            await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_SIGNING].address, EUR_100);
          });
        });
        it('Negative test. Send EUR-T to IP while it is in Claim state', async () => {
          await expectToRevert(VMException, async () => {
            await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_CLAIM].address, EUR_100);
          });
        });
        it('Negative test. Send EUR-T to IP while it is in Refund state', async () => {
          await expectToRevert(VMException, async () => {
            await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_REFUND].address, EUR_100);
          });
        });
        it('Negative test. Send EUR-T to IP while it is in Payout state', async () => {
          await expectToRevert(VMException,async () => {
            await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PAYOUT].address, EUR_100);
          });
        });
      });

      describe('Only EUR-T token is accepted as contribution', async() => {
        it('Positive test. Send EUR-T to IP', async () => {
          await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PUBLIC].address, EUR_100);
        });
        it('Negative test. Send not a EUR-T to IP', async () => {
          const BadTokenFactory = artifacts.require('./../contracts/test/SomeOtherERC223Token.sol');
          const badToken = await BadTokenFactory.new({gas: 1000000});
          await badToken.setBalance(goodInvestors[0], EUR_100);
          await expectToRevert("Wrong Token", async () => {
            await badToken.transfer(ips[ETO_STATE_PUBLIC].address, EUR_100, '', {from: goodInvestors[0], gas: 1000000});
          });
        });
      });

      describe('Only NeuFund approved addresses should be allowed to contribute', async() => {
        it('Positive test. Send EUR-T to IP from approved address', async () => {
          await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PUBLIC].address, EUR_100);
        });
        it('Negative test. Send EUR-T to IP from unapproved address', async () => {
          await expectToRevert(VMException, async () => {
            await transferToken(euroToken, badInvestor, ips[ETO_STATE_PUBLIC].address, EUR_100);
          });
        });
      });

      ////Only contributions greater or equal to minimum cap are allowed
      //Negative test. Sent EUR-T amount less than IP minimum cap
      //Positive test. Sent EUR-T amount equal to IP minimum cap
      //Positive test. Sent EUR-T amount greater than IP minimum cap

      describe('Only contributions greater or equal to minimum cap are allowed', async() => {
        it('Negative test. Sent EUR-T amount less than IP minimum cap', async () => {
          await expectToRevert("Amount is below minimum cap", async () => {
            await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PUBLIC].address, EUR_1);
          });
        });
        it('Positive test. Sent EUR-T amount equal to IP minimum cap', async () => {
          await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PUBLIC].address, MinimumCap);
        });
        it('Positive test. Sent EUR-T amount greater than IP minimum cap', async () => {
          await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PUBLIC].address, EUR_101);
        });
      });

      ////Cannot contribute more than 2^90
      describe('Cannot contribute more than 2^90', async() => {
        it('Negative test. Cannot contribute more than ETO Max Ticket', async () => {
          await expectToRevert(VMException, async () => {
            await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PUBLIC].address, maxETOTicket.plus(web3.toBigNumber(1)));
          });
        });
      });

      ////When batch size is reached, IP Owner should be able to send all received up to date funds to ETO contract
      //Positive test. Commit.
      describe('When batch size is reached, IP Owner should be able to send all received up to date funds to ETO contract', async() => {
        before(async function () {
          await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PUBLIC].address, EUR_100K);
        });
        it('Positive test. Commit as owner.', async () => {
          await ips[ETO_STATE_PUBLIC].commitFunds();
        });
        it('Negative test. Commit as some other address.', async () => {
          await expectToRevert(VMException, async () => {
            await ips[ETO_STATE_PUBLIC].commitFunds({from: badInvestor});
          });
        });
      });

      describe('Claim commissions from IP', async() => {
        it('Negative test. Claim commissions while ETO is in Public state', async () => {
          await expectToRevert(VMException, async () => {
            await ips[ETO_STATE_PUBLIC].claimCommission();
          });
        });
      });

      ////If ETO is ended because maximum cap is reached, and no more contributions are accepted, IP contract should not accept funds
      // Skip this because (a) this is a rare happy situation (b) this will screw up test automation
    });


    //////ETO Success
    describe('ETO Success', async() => {

      // Setup successful ETO
      before(async function () {

        var state = await etoObj.state();
        if (state == ETO_STATE_PUBLIC) {
          // Get minimum tokens to be invested for successful ETO
          const etoTokenTermsAddr = await etoTerms.TOKEN_TERMS();
          const etoTokenTermsJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/ETOTokenTerms.json`, 'utf8'));
          const etoTokenTermsFactory = web3.eth.contract(etoTokenTermsJSON.abi);
          const etoTokenTermsObj = etoTokenTermsFactory.at(etoTokenTermsAddr);
          const minTokens = await etoTokenTermsObj.MIN_NUMBER_OF_TOKENS();
          //console.log("minTokens = ", minTokens.toString());

          // Invest+Commit until the soft cap is reached
          var totalInvestment;
          do {

            // All good investors contribute accordingly to investments array
            for (var i=0; i<goodInvestors.length; i++) {
              var investmentAmount = investments[i];
              await transferToken(euroToken, goodInvestors[i], ips[ETO_STATE_PUBLIC].address, investmentAmount);
              //console.log("Investor contributed ", i);
            }

            // Commit
            await ips[ETO_STATE_PUBLIC].commitFunds();

            // Check total investment in ETO
            totalInvestment = await etoObj.totalInvestment();
            //console.log("totalEquivEurUlps = ", totalInvestment[0].toString());
            //console.log("totalTokensInt = ", totalInvestment[1].toString());
            //console.log("totalInvestors = ", totalInvestment[2].toString());

          } while (totalInvestment[1].lt(minTokens));

          // For refund test:
          // Third investor insvests some funds that will not be committed (subject to refund later)
          //await transferToken(euroToken, goodInvestors[2], ips[ETO_STATE_PUBLIC].address, investments[2]);

          // Get timestamp when Signing stage starts
          var startOfStates = await etoObj.startOfStates();
          startOfSigning = startOfStates[ETO_STATE_SIGNING].toNumber();
          //console.log(startOfSigning);

          const currentTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
          //console.log(currentTime);
          const timeDiff = startOfSigning - currentTime + 1;
          //console.log(timeDiff);

          // Advance ETO to Signing state by moving time by timeDiff seconds
          var state = await etoObj.state();
          //console.log(state.toString());
          if ((timeDiff > 0) && (state == ETO_STATE_PUBLIC)) {

            // Move time
            await increaseTime(timeDiff);
            await mineNewBlock();

            // Trigger ETO state change
            await etoObj.handleStateTransitions({from: owner, gas: 1000000});
          }

          state = await etoObj.state();
          //console.log(state.toString());
        }

        // Advance to Claim state by signing agreement between nominee and company
        state = await etoObj.state();
        //console.log(state.toString());
        if (state == ETO_STATE_SIGNING) {
          const agreementURL = "someurl";
          const companyRep = await etoObj.companyLegalRep();
          const moninee = await etoObj.nominee();
          await etoObj.companySignsInvestmentAgreement(agreementURL, {from: companyRep});
          await etoObj.nomineeConfirmsInvestmentAgreement(agreementURL, {from: moninee, gas: 1000000});
        }
        state = await etoObj.state();
        //console.log(state.toString());

        // Allow all Equity Token transfers. At original NeuFund deployment etoTerms.ENABLE_TRANSFERS_ON_SUCCESS returns false
        // because PlaceholderTokenController.onTransfer is implemented that way, and Equity Tokent ransfers are disabled.
        // 1. Deploy a new Token controller
        testEquityTokenController = await TestTokenController.new(universeAddr, owner);
        // 2. Do migration in old controller
        const companyRep = await etoObj.companyLegalRep();

        var etcstate = await equityTokenController.state();
        //console.log("token controller state = ", etcstate.toString());

        await equityTokenController.changeTokenController(testEquityTokenController.address, {from: companyRep});
        // 3. Do the final change in token
        await equityToken.changeTokenController(testEquityTokenController.address, {from: companyRep});

        etcstate = await equityTokenController.state();
        //console.log("token controller state after controller change = ", etcstate.toString());
      });

      describe('Sanity checks', async() => {
        it('Check ETO is in Claim state', async () => {
          var state = await etoObj.state();
          state.should.be.bignumber.equal(ETO_STATE_CLAIM);
        });
        it('Check Equity Transfers are enabled', async () => {
          var enabled = await testEquityTokenController.onTransfer(owner, ips[ETO_STATE_PUBLIC].address, goodInvestors[0], 1);
          enabled.should.be.equal(true);
        });
      });

      ////IP Contract Claims Rewards
      describe('IP Contract Claims Rewards', async() => {
        it('Negative test. Wrong address claims rewards', async () => {
          await expectToRevert(VMException, async () => {
            await ips[ETO_STATE_PUBLIC].claimInvestmentPoolReward({from: badInvestor});
          });
        });
        it('Positive test. IP owner claims rewards', async () => {
          await ips[ETO_STATE_PUBLIC].claimInvestmentPoolReward();
        });
      });

      describe('Claim commissions from IP', async() => {
        it('Negative test. Claim commissions while ETO is in Claim state', async () => {
          await expectToRevert(VMException, async () => {
            await ips[ETO_STATE_PUBLIC].claimCommission();
          });
        });
      });

      ////Equity Tokens and NEU are distributed proportionally between contributors
      describe('Equity Tokens and NEU are distributed proportionally between contributors', async() => {
        it('Investors can claim and get correct amount of NEU and Equity Token', async () => {

          // Get IP balance of NeuMark and Equity Token
          const ipNeuBalance = await neuMark.balanceOf(ips[ETO_STATE_PUBLIC].address);
          const ipEtBalance = await equityToken.balanceOf(ips[ETO_STATE_PUBLIC].address);
          //console.log("ipNeuBalance = ", ipNeuBalance.toString());
          //console.log("ipEtBalance = ", ipEtBalance.toString());

          // Investors claim
          var neuMarkRewards = [];
          var etRewards = [];
          var contributionProportions = [];
          var nmRewardProportions = [];
          var etRewardProportions = [];
          var totalInvestorNeu = web3.toBigNumber(0);
          var totalInvestorEt = web3.toBigNumber(0);
          for (var i=0; i<goodInvestors.length; i++) {
            const neuBalanceBefore = await neuMark.balanceOf(goodInvestors[i]);
            const etBalanceBefore = await equityToken.balanceOf(goodInvestors[i]);
            await ips[ETO_STATE_PUBLIC].claimRewards({from: goodInvestors[i]});
            const neuBalanceAfter = await neuMark.balanceOf(goodInvestors[i]);
            const etBalanceAfter = await equityToken.balanceOf(goodInvestors[i]);

            //console.log(`Investor ${i} claimed. New NEU balance: ${neuBalanceAfter}`);
            //console.log(`Investor ${i} claimed. New ET balance: ${etBalanceAfter}`);

            neuMarkRewards.push(neuBalanceAfter.minus(neuBalanceBefore));
            etRewards.push(etBalanceAfter.minus(etBalanceBefore));

            if (i==0) {
              contributionProportions[i] = web3.toBigNumber(1.0);
              nmRewardProportions[i] = web3.toBigNumber(1.0);
              etRewardProportions[i] = web3.toBigNumber(1.0);
            } else {
              contributionProportions[i] = investments[i].div(investments[0]);
              nmRewardProportions[i] = neuMarkRewards[i].div(neuMarkRewards[0]);
              etRewardProportions[i] = etRewards[i].div(etRewards[0]);
            }
          }

          // Verify that rewards are proportional to contriutions
          // Calculate total rewards that were paid out
          for (var i=0; i<contributionProportions.length; i++) {
            contributionProportions[i].minus(nmRewardProportions[i]).abs()
              .should.be.bignumber.lt(BNTolerance);
            contributionProportions[i].minus(etRewardProportions[i]).abs()
              .should.be.bignumber.lt(BNTolerance);

            totalInvestorNeu = totalInvestorNeu.add(neuMarkRewards[i]);
            totalInvestorEt = totalInvestorEt.add(etRewards[i]);
          }

          // Verify that all NEU and ET tokens are distributed
          //console.log("totalInvestorNeu = ", totalInvestorNeu.toString());
          //console.log("totalInvestorEt = ", totalInvestorEt.toString());
          totalInvestorNeu.should.be.bignumber.equal(ipNeuBalance);
          totalInvestorEt.should.be.bignumber.equal(ipEtBalance);
        });

        ////Negative test. Double claims are prevented.
        it('Negative test. Double claims are prevented.', async () => {
          for (var i=0; i<goodInvestors.length; i++) {
            await expectToRevert(VMException, async () => {
              await ips[ETO_STATE_PUBLIC].claimRewards({from: goodInvestors[i]});
            });
          }
        });

      });

    });




////There should be a way to return contributions in case if Batch Size is not reached by the end of ETO.
//Negative test. Claim refund when ETO is in Setup state.
//Negative test. Claim refund when ETO is in Whitelist state.
//Negative test. Claim refund when ETO is in Public state.
//Positive test. Claim refund when ETO is in Claim state. No batches commited.
//Positive test. Claim refund when ETO is in Payout state. No batches commited.
//Positive test. Claim refund when ETO is in Claim state. One batch commited.
//Positive test. Claim refund when ETO is in Claim state. Two batches commited.

////Negative test. No double returns.

    //////ETO Failure
    ////Positive test. Contributor claims refund from IP.
    ////Negative test. Contributors cannot claim refund from IP more than once.
    //Negative test. Contributors claims refund 2 times.
    //Negative test. Contributors claims refund 3 times.
    describe.skip('ETO Failure', async() => {

      // Setup failed ETO
      before(async function () {
        /*
        // Invest 100K
        await transferToken(euroToken, goodInvestors[0], ips[ETO_STATE_PUBLIC].address, EUR_100K);

        // Get the duration of ETO public state
        const etoDurationAddr = await etoTerms.DURATION_TERMS();
        const etoDurationJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/ETODurationTerms.json`, 'utf8'));
        const etoDurationFactory = web3.eth.contract(etoDurationJSON.abi);
        const etoDurationObj = etoDurationFactory.at(etoDurationAddr);
        publicDuration = await etoDurationObj.PUBLIC_DURATION();

        // Advance ETO to Signing state by moving time by publicDuration seconds
        var state = await etoObj.state();
        if (state == ETO_STATE_PUBLIC) {
          // Move time
          await increaseTime(publicDuration.toNumber());
          await mineNewBlock();

          // Trigger ETO state change
          await etoObj.handleStateTransitions({from: owner, gas: 1000000});
        }
        */
      });

      describe('Sanity check: ETO is in Refund state', async() => {
        it('Check ETO state', async () => {
        });
      });


    });



    // Claim commissions while ETO is in Payout state
    /*
    describe('Claim commissions from IP', async() => {
      it('Negative test. Claim commissions from non-beneficiary address', async () => {
        await expectToRevert(VMException, async () => {
          await ips[ETO_STATE_PUBLIC].claimCommission({from: badInvestor});
        });
      });
      it('Positive test. IP owner claims rewards', async () => {
        await ips[ETO_STATE_PUBLIC].claimInvestmentPoolReward();
      });
    });
    */



//////Reporting
////Contributors can see their contributed balance
////Contributors can see their committed balance
////Totals are reported correctly in getSummary method

//////Common tests
////IP rejects ETH on default method


  });

});
