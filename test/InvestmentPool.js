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

async function expectToRevert(func) {
  try {
    await func();
    throw(Error("Call did not revert"));
  } catch (error) {
    if (!error.toString().includes(VMException))
      throw(error);
  }
}

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
  const KNOWN_INTERFACE_COMMITMENT = 0xfa0e0c60;
  let etos = {}; // ETOs in all states
  let universeAddr;
  let ips = {}; // IPs with ETOs in all states
  const UniverseContract = artifacts.require('./../platform-contracts/contracts/Universe.sol');
  const EuroTokenContract = artifacts.require('./../platform-contracts/contracts/PaymentTokens/EuroToken.sol');
  let universe;
  let euroToken;
  let eurtDepositManagerAddress;
  let idRegistry;
  let idManagerAddress;
  let tokenController;

  // Accounts
  const owner = web3.toChecksumAddress(accounts[0]);
  const commissionBeneficiary = web3.toChecksumAddress(accounts[1]);
  const goodInvestor = web3.toChecksumAddress(accounts[2]);
  const badInvestor = web3.toChecksumAddress(accounts[3]);

  // IP Parameters
  const InvestorBalance = 10 ** 24;
  const MinimumCap = 10 ** 20;
  const EUR_100 = 10 ** 20;

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

      // Get instance of Identity Registry
      const idRegistryAddress = await universe.identityRegistry();
      const idRegJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/IIdentityRegistry.json`, 'utf8'));
      const idRegFactory = web3.eth.contract(idRegJSON.abi);
      idRegistry = idRegFactory.at(idRegistryAddress);

      // Register goodInvestor address in KYC
      const newClaims = toBytes32("0x7");
      var oldClaims = await idRegistry.getClaims(goodInvestor);
      await idRegistry.setClaims(goodInvestor, oldClaims, newClaims, {from: owner});

      // Register IP addresses in KYC
      for (var state in ips) {
        oldClaims = await idRegistry.getClaims(ips[state].address);
        await idRegistry.setClaims(ips[state].address, oldClaims, newClaims, {from: owner});
      }

      // Register IP addresses in Universe as ICommitment interface
      for (var state in ips) {
        await universe.setCollectionInterface(KNOWN_INTERFACE_COMMITMENT, ips[state].address, true, {from: owner, gas: 1000000});
      }

      // Buy some EUR-T for investors
      var eurtBalance = (await euroToken.balanceOf(goodInvestor)).toNumber();
      if (eurtBalance < InvestorBalance) {
        await euroToken.deposit(goodInvestor, InvestorBalance, "", {from: owner});
      }
      eurtBalance = (await euroToken.balanceOf(badInvestor)).toNumber();
      if (eurtBalance < InvestorBalance) {
        await euroToken.deposit(badInvestor, InvestorBalance, "", {from: owner});
      }

      // Get instance of Token Controller
      const tokenControllerAddress = await euroToken.tokenController();
      const tokenControllerJSON = JSON.parse(fs.readFileSync(`${__dirname}/../build/contracts/EuroTokenController.json`, 'utf8'));
      const tokenControllerFactory = web3.eth.contract(tokenControllerJSON.abi);
      tokenController = tokenControllerFactory.at(tokenControllerAddress);

      // Allow transfers to IPs
      var oldClaims;
      for (var state in ips) {
        oldClaims = await idRegistry.getClaims(ips[state].address);
        await tokenController.setAllowedTransferTo(ips[state].address, true, {from: owner});
      }

      // Allow Transfers from goodInvestor
      oldClaims = await idRegistry.getClaims(goodInvestor);
      await tokenController.setAllowedTransferFrom(goodInvestor, true, {from: owner});

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
        const eurtGoodBalance = (await euroToken.balanceOf(goodInvestor)).toNumber();
        const eurtBadBalance = (await euroToken.balanceOf(badInvestor)).toNumber();
        eurtGoodBalance.should.be.at.least(InvestorBalance);
        eurtBadBalance.should.be.at.least(InvestorBalance);
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
          await expectToRevert(async () => {
            await transferToken(euroToken, goodInvestor, ips[ETO_STATE_SETUP].address, EUR_100);
          });
        });
        it('Negative test. Send EUR-T to IP while it is in Whitelist state', async () => {
          await expectToRevert(async () => {
            await transferToken(euroToken, goodInvestor, ips[ETO_STATE_WHITELIST].address, EUR_100);
          });
        });
        it('Positive test. Send EUR-T to IP while it is in Public state', async () => {
          await transferToken(euroToken, goodInvestor, ips[ETO_STATE_PUBLIC].address, EUR_100);
        });
        it('Negative test. Send EUR-T to IP while it is in Signing state', async () => {
          await expectToRevert(async () => {
            await transferToken(euroToken, goodInvestor, ips[ETO_STATE_SIGNING].address, EUR_100);
          });
        });
        it('Negative test. Send EUR-T to IP while it is in Claim state', async () => {
          await expectToRevert(async () => {
            await transferToken(euroToken, goodInvestor, ips[ETO_STATE_CLAIM].address, EUR_100);
          });
        });
        it('Negative test. Send EUR-T to IP while it is in Refund state', async () => {
          await expectToRevert(async () => {
            await transferToken(euroToken, goodInvestor, ips[ETO_STATE_REFUND].address, EUR_100);
          });
        });
        it('Negative test. Send EUR-T to IP while it is in Payout state', async () => {
          await expectToRevert(async () => {
            await transferToken(euroToken, goodInvestor, ips[ETO_STATE_PAYOUT].address, EUR_100);
          });
        });
      });

      describe('Only EUR-T token is accepted as contribution', async() => {
        it('Positive test. Send EUR-T to IP', async () => {
          await expectToRevert(async () => {
            await transferToken(euroToken, goodInvestor, ips[ETO_STATE_PUBLIC].address, EUR_100);
          });
        });
        it('Negative test. Send not a EUR-T to IP', async () => {
          await expectToRevert(async () => {



            await transferToken(euroToken, goodInvestor, ips[ETO_STATE_PUBLIC].address, EUR_100);
          });
        });
      });




    })


  });

});
