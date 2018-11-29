const fs = require("fs");
const solc = require('solc');
var Web3 = require('web3');
//var w3 = new Web3(new Web3.providers.HttpProvider('https://rinkeby.infura.io'));
var w3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:8545'));
//var w3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:8101'));

// Compile source file from cmd line argument
var sourceFile = process.argv[2];
var contractName = process.argv[3];
console.log("Compiling " + contractName + " contract from solidity file " + sourceFile + " ...");
var source = fs.readFileSync(sourceFile, 'utf8');
var cc = solc.compile(source);
//console.log("cc =", cc);

var bytecode = '0x' + cc.contracts[':' + contractName].bytecode;
var abi = cc.contracts[':' + contractName].interface;

// Add constructor parameter at the end of bytecode
var bytecodeWithParam = bytecode;
if (process.argv[4] !== undefined) {
    if (process.argv[4].length != 64) {
        console.log("ERROR: Token address is not 32 bytes!");
        process.exit();
    }
    var bytecodeWithParam = bytecode + process.argv[4];
}

//w3.eth.estimateGas({data: bytecode}).then(gasEstimate => {
//    console.log("Deployment gas estimate: " + gasEstimate + "\n")
//});

fs.writeFile("build/" + contractName + ".bytecode", bytecodeWithParam, function(err) {
    if(err) {
        return console.log(err);
    }
});
fs.writeFile("build/" + contractName + ".abi", abi, function(err) {
    if(err) {
        return console.log(err);
    }
});
