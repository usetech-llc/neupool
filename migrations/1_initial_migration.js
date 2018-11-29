var Migrations = artifacts.require('./Migrations.sol');

module.exports = function (deployer, args) {
  deployer.deploy(Migrations)
}
