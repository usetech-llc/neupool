#!/bin/bash

docker cp platform-contracts:/usr/src/platform-contracts/build/meta.json ./test/
rc=$?; if [[ $rc != 0 ]]; then exit $rc; fi
docker cp platform-contracts:/usr/src/platform-contracts/build/eto_fixtures.json ./test/
rc=$?; if [[ $rc != 0 ]]; then exit $rc; fi

truffle compile
truffle migrate
truffle test test/InvestmentPool.js
