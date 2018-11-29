const BigNumber = web3.BigNumber;
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should();

contract('InvestmentPool', function (accounts) {
  const InvestmentPool = artifacts.require('./../contracts/InvestmentPool.sol');
  let ip;

  describe('InvestmentPool tests', async () => {
    beforeEach(async function () {
      // Provide enough gas for deployment
      ip = await InvestmentPool.new({gas: 10000000});
    });

    describe('Common tests', async() => {
      it('', async () => {
      });
    })

  });

});
