#!/bin/bash

function processSourceFile {
    input=$1
    while IFS= read -r line
    do
        if [[ $line != *"pragma"* && $line != *"import"* ]]; then
            echo "$line" >> $2
        fi

    done < "$input"
}

ipSources=("contracts/Owned.sol" "contracts/InvestmentPool.sol")

function processSources {
    local -n arr=$1
    echo "Making bundle $2"
    echo $'pragma solidity 0.4.18;\n' > $2
    for i in "${arr[@]}"
    do
       processSourceFile "$i" "$2"
    done
}

mkdir bundles

processSources tokenSources "bundles/ip.bundle.sol"

node build.js bundles/ip.bundle.sol InvestmentPool
