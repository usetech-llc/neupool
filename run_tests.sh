
docker cp platform-contracts:/usr/src/platform-contracts/platform-contracts-artifacts/localhost/meta.json ./test/
docker cp platform-contracts:/usr/src/platform-contracts/platform-contracts-artifacts/localhost/eto_fixtures.json ./test/

truffle test test/InvestmentPool.js
