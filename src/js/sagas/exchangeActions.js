import { take, put, call, fork, takeEvery, cancel } from 'redux-saga/effects'
import { delay } from 'redux-saga'
import * as actions from '../actions/exchangeActions'
import * as globalActions from "../actions/globalActions"
import { setConnection } from "../actions/connectionActions"
import EthereumService from "../services/ethereum/ethereum"
import NotiService from "../services/noti_service/noti_service"
import * as web3Package from "../services/web3"
import * as common from "./common"
import * as commonFunc from "../utils/common"
import { updateAccount, incManualNonceAccount } from '../actions/accountActions'
import { addTx } from '../actions/txActions'
import * as utilActions from '../actions/utilActions'
import constants from "../services/constants"
import * as converter from "../utils/converter"
import * as ethUtil from 'ethereumjs-util'
import Tx from "../services/tx"
import { getTranslate } from 'react-localize-redux';
import { store } from '../store'
import BLOCKCHAIN_INFO from "../../../env"

function* approveTx(action) {
  try {
    const { ethereum, tx, callback } = action.payload
    const hash = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", tx)
    callback(hash, tx)
    yield put(actions.doApprovalTransactionComplete(hash, action.meta))
  }
  catch (e) {
    console.log(e)
    yield put(actions.doApprovalTransactionFail(e.message, action.meta))
  }
}

function* swapToken(action){
  const {source, dest} = action.payload
  yield call(estimateGasUsed,dest, source)
}

function* selectToken(action) {
  const { symbol, address, type, ethereum } = action.payload

  yield put.sync(actions.selectToken(symbol, address, type))
  yield put(utilActions.hideSelectToken())
  yield put(actions.checkSelectToken())

  var state = store.getState()
  var exchange = state.exchange

  if (type === 'source') {
    yield call(estimateGasUsed, symbol, exchange.destTokenSymbol)
  } else {
    yield call(estimateGasUsed, exchange.sourceTokenSymbol, symbol)
  }

  if (exchange.sourceTokenSymbol === exchange.destTokenSymbol) {
    yield put(actions.selectTokenComplete())
    return
  }


  if (exchange.isHaveDestAmount) {
    if (exchange.destTokenSymbol === "ETH") {
      if (parseFloat(exchange.destAmount) > constants.MAX_AMOUNT_RATE_HANDLE) {
        yield put(actions.throwErrorHandleAmount())
        return
      }
    } else {
      var tokens = state.tokens.tokens
      var destValue = converter.calculateDest(exchange.destAmount, tokens[exchange.destTokenSymbol].rate, 6)

      if (parseFloat(destValue) > constants.MAX_AMOUNT_RATE_HANDLE) {
        yield put(actions.throwErrorHandleAmount())
        return
      }
    }
    yield call(ethereum.fetchRateExchange, true)
  } else {
    yield call(ethereum.fetchRateExchange, true)
  }
}

export function* estimateGasUsed(source, dest) {
  const state = store.getState();
  const exchange = state.exchange;
  const tokens = state.tokens.tokens;
  const isPayMode = !exchange.isSwap;

  var gasUsed
  var gasApproved = 0

  if (exchange.type === "pay"){
    if (source === dest) {
      switch (source) {
        case "ETH":
          gasUsed = constants.PAYMENT_ETH_TRANSFER_GAS
          break
        case "DGX":
          gasUsed = 250000
          gasApproved = 120000
          break
        default:
          gasUsed = constants.PAYMENT_TOKEN_TRANSFER_GAS;
          gasApproved = 120000;
          break
      }
    } else {
      gasUsed = yield call(getMaxGasExchange, source, dest)      
      gasApproved = yield call(getMaxGasApprove, tokens[source].gasApprove)
    }
  }else{
    if (source === dest) {
      switch (source) {
        case "ETH":
          gasUsed = 21000
          break
        case "DGX":
          gasUsed = 250000
          break
        default:
          gasUsed = 120000;
          break
      }
      gasApproved = 0
    } else {
      gasUsed = yield call(getMaxGasExchange, source, dest)
      if (source !== "ETH") {
        gasApproved = yield call(getMaxGasApprove, tokens[source].gasApprove)
      }
    }
  }
  console.log("estimate_gase")
  console.log({gasUsed, gasApproved})
  yield put(actions.setEstimateGas(gasUsed, gasApproved))
}



export function* runAfterBroadcastTx(ethereum, txRaw, hash, account, data) {

  if(account.type === 'metamask'){
     yield put (actions.goToStep(4))
  }

  try {
    yield call(getInfo, hash)
  } catch (e) {
    console.log(e)
  }

  //track complete trade
  var state = store.getState()
  var exchange = state.exchange
  var analytics = state.global.analytics

  analytics.callTrack("completeTransaction", exchange.sourceTokenSymbol, exchange.destTokenSymbol)

  yield fork(common.submitCallback, hash)

  const tx = new Tx(
    hash, account.address, ethUtil.bufferToInt(txRaw.gas),
    converter.weiToGwei(ethUtil.bufferToInt(txRaw.gasPrice)),
    ethUtil.bufferToInt(txRaw.nonce), "pending", "exchange", data)
  yield put(incManualNonceAccount(account.address))
  yield put(updateAccount(ethereum, account))
  yield put(addTx(tx))
  yield put(actions.doTransactionComplete(hash))
  yield put(actions.finishExchange())
  yield put(actions.resetSignError())
}

function* getInfo(hash) {
  var state = store.getState()
  var ethereum = state.connection.ethereum

  yield call([ethereum, ethereum.call], "getInfo", { hash })
}

function* doTxFail(ethereum, account, e) {
  var state = store.getState()
  var exchange = state.exchange
  yield put(actions.goToStep(4));

  var error = e
  if (!error) {
    var translate = getTranslate(store.getState().locale)
    var link = BLOCKCHAIN_INFO[exchange.network].ethScanUrl + "address/" + account.address
    error = translate("error.broadcast_tx", { link: link }) || "Potentially Failed! We likely couldn't broadcast the transaction to the blockchain. Please check on Etherscan to verify."
  }
  yield put(actions.setBroadcastError(error))
}


function isApproveTxPending() {
  //check have approve tx
  const state = store.getState()
  const tokens = state.tokens.tokens
  const sourceTokenSymbol = state.exchange.sourceTokenSymbol
  return !!tokens[sourceTokenSymbol].approveTx
}

export function* checkTokenBalanceOfColdWallet(action) {
  const { ethereum, address, sourceToken, sourceAmount } = action.payload
  let translate = getTranslate(store.getState().locale)
  const isPayMode = checkIsPayMode();

  try {
    const remainStr = yield call([ethereum, ethereum.call], "getAllowanceAtLatestBlock", sourceToken, address, isPayMode)
    const remain = converter.hexToBigNumber(remainStr)
    const sourceAmountBig = converter.hexToBigNumber(sourceAmount)

    if (!remain.isGreaterThanOrEqualTo(sourceAmountBig) && !isApproveTxPending()) {
      yield put(actions.showApprove())
      yield call(fetchGasApproveSnapshot)
    } else {
      yield put(actions.showConfirm())
      yield call(fetchGasConfirmSnapshot)
    }
  } catch (e) {
    let title = translate("error.error_occurred") || "Error occurred"
    let content = translate("error.network_error") || "Cannot connect to node right now. Please check your network!"
    yield put(utilActions.openInfoModal(title, content))
  }
}

function* processApprove(action) {
  const { accountType } = action.payload

  yield put(actions.resetSignError());

  switch (accountType) {
    case "trezor":
    case "ledger":
      yield call(processApproveByColdWallet, action)
      break
    case "metamask":
      yield call(processApproveByMetamask, action)
      break
  }
}

export function* processApproveByColdWallet(action) {
  const { ethereum, sourceToken, sourceAmount, nonce, gas, gasPrice,
    keystring, password, accountType, account, keyService, sourceTokenSymbol } = action.payload

  var networkId = common.getNetworkId()
  let rawApprove
  const isPayMode = checkIsPayMode();

  try {
    rawApprove = yield call(keyService.callSignTransaction, "getAppoveToken", isPayMode, ethereum, sourceToken,
      sourceAmount, nonce, gas, gasPrice, keystring, password, accountType, account.address, networkId)
  } catch (e) {
    console.log(e)
    let msg = ''
    if (isLedgerError(accountType, e)) {
      msg = keyService.getLedgerError(e)
    } else {
      msg = e.message
    }
    yield put(actions.setSignError(msg))
    return
  }
  var hashApprove
  try {


    hashApprove = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", rawApprove)

    yield put(actions.setApproveTx(hashApprove, sourceTokenSymbol));
    yield put(incManualNonceAccount(account.address));
    yield put(actions.setApprove(false));
    yield put(actions.fetchGasSuccess());
    yield put(actions.unsetConfirming());
  } catch (e) {
    yield call(doTxFail, ethereum, account, e.message)
  }
}

export function* processApproveByMetamask(action) {
  const { ethereum, sourceToken, sourceAmount, nonce, gas, gasPrice,
    keystring, password, accountType, account, keyService, sourceTokenSymbol } = action.payload;

  var networkId = common.getNetworkId()
  const isPayMode = checkIsPayMode();

  try {
    const hashApprove = yield call(keyService.callSignTransaction, "getAppoveToken", isPayMode, ethereum, sourceToken,
      sourceAmount, nonce, gas, gasPrice, keystring, password, accountType, account.address, networkId);

    yield put(actions.setApproveTx(hashApprove, sourceTokenSymbol));
    yield put(incManualNonceAccount(account.address));
    yield put(actions.setApprove(false));
    yield put(actions.fetchGasSuccess());
    yield put(actions.unsetConfirming());
  } catch (e) {
    yield put(actions.setSignError(e))
  }
}

export function* processExchange(action) {
  const { type, sourceToken } = action.payload;

  yield put(actions.resetSignError());

  if (sourceToken === constants.ETHER_ADDRESS) {
    switch (type) {
      case "keystore":
        yield call(exchangeETHtoTokenKeystore, action)
        break
      case "privateKey":
        yield call(exchangeETHtoTokenPrivateKey, action)
        break
      case "trezor":
      case "ledger":
        yield call(exchangeETHtoTokenColdWallet, action)
        break
      case "metamask":
        yield call(exchangeETHtoTokenMetamask, action)
        break
    }
  } else {
    switch (type) {
      case "keystore":
        yield call(exchangeTokentoETHKeystore, action)
        break
      case "privateKey":
        yield call(exchangeTokentoETHPrivateKey, action)
        break
      case "metamask":
        yield call(exchangeTokentoETHMetamask, action)
        break
      case "trezor":
      case "ledger":
        yield call(exchangeTokentoETHColdWallet, action)
        break
    }
  }
}

export function* doBeforeMakeTransaction(txRaw) {
  yield put(actions.goToStep(4))

  var state = store.getState()
  var ethereum = state.connection.ethereum
  yield call([ethereum, ethereum.call], "getTxHash", txRaw)

  return true
}

export function* exchangeETHtoTokenKeystore(action) {
  const {
    formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
    nonce, gas, gasPrice, keystring, type, password, account, data, keyService, balanceData,
    blockNo, paymentData, hint } = action.payload;

  var networkId = common.getNetworkId()
  var txRaw;

  try {
    txRaw = yield callService(
      "etherToOthersFromAccount", "etherToOthersPayment",
      keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount,
      minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
    )
  } catch (e) {
    console.log(e)
    yield put(actions.throwPassphraseError(e.message))
    return
  }
  try {
    yield put(actions.prePareBroadcast(balanceData))

    var response = yield call(doBeforeMakeTransaction, txRaw)
    console.log(response)

    var hash = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", txRaw)
    yield call(runAfterBroadcastTx, ethereum, txRaw, hash, account, data)
  } catch (e) {
    console.log(e)
    yield call(doTxFail, ethereum, account, e.message)
    return
  }
}

export function* exchangeETHtoTokenPrivateKey(action) {
  const {
    formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
    nonce, gas, gasPrice, keystring, type, password, account, data, keyService, balanceData,
    blockNo, paymentData, hint } = action.payload;

  var networkId = common.getNetworkId()

  try {
    var txRaw
    try {
      txRaw = yield callService(
        "etherToOthersFromAccount", "etherToOthersPayment",
        keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount,
        minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
      )
    } catch (e) {
      console.log(e)
      yield put(actions.setSignError(e.message))
      return
    }

    yield put(actions.prePareBroadcast(balanceData))

    var response = yield call(doBeforeMakeTransaction, txRaw)
    console.log(response)

    const hash = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", txRaw)
    yield call(runAfterBroadcastTx, ethereum, txRaw, hash, account, data)
  } catch (e) {
    console.log(e)
    yield call(doTxFail, ethereum, account, e.message)
    return
  }
}

export function* exchangeETHtoTokenColdWallet(action) {
  const {
    formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
    nonce, gas, gasPrice, keystring, type, password, account, data, keyService, balanceData,
    blockNo, paymentData, hint } = action.payload;

  var networkId = common.getNetworkId()

  try {
    var txRaw
    try {
      txRaw = yield callService(
        "etherToOthersFromAccount", "etherToOthersPayment",
        keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount,
        minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
      )
    } catch (e) {
      console.log(e)
      let msg = ''
      if (isLedgerError(type, e)) {
        msg = keyService.getLedgerError(e)
      } else {
        msg = e.message
      }
      yield put(actions.setSignError(msg))
      return
    }
    yield put(actions.prePareBroadcast(balanceData))

    var response = yield call(doBeforeMakeTransaction, txRaw)
    console.log(response)

    const hash = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", txRaw)
    yield call(runAfterBroadcastTx, ethereum, txRaw, hash, account, data)
  } catch (e) {
    console.log(e)
    yield call(doTxFail, ethereum, account, e.message)
    return
  }
}

function* exchangeETHtoTokenMetamask(action) {
  const {
    formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
    nonce, gas, gasPrice, keystring, type, password, account, data, keyService, balanceData,
    blockNo, paymentData, hint } = action.payload

  var networkId = common.getNetworkId()

  try {
    var hash
    try {
      hash = yield callService(
        "etherToOthersFromAccount", "etherToOthersPayment",
        keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount,
        minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
      )
    } catch (e) {
      yield put(actions.setSignError(e))
      return
    }

    yield put(actions.prePareBroadcast(balanceData))
    const txRaw = { gas, gasPrice, nonce }
    yield call(runAfterBroadcastTx, ethereum, txRaw, hash, account, data)
  } catch (e) {
    yield call(doTxFail, ethereum, account, e.message)
    return
  }
}

function* exchangeTokentoETHKeystore(action) {
  var {
    formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
    nonce, gas, gasPrice, keystring, type, password, account, data, keyService, balanceData,
    sourceTokenSymbol, blockNo, paymentData, hint } = action.payload;

  var networkId = common.getNetworkId()
  const isPayMode = checkIsPayMode();

  var remainStr = yield call([ethereum, ethereum.call], "getAllowanceAtLatestBlock", sourceToken, address, isPayMode)
  console.log("remain: " + remainStr)
  var remain = converter.hexToBigNumber(remainStr)
  var sourceAmountBig = converter.hexToBigNumber(sourceAmount)
  if (!remain.isGreaterThanOrEqualTo(sourceAmountBig) && !isApproveTxPending()) {
    var rawApprove
    try {
      rawApprove = yield call(keyService.callSignTransaction, "getAppoveToken", isPayMode, ethereum, sourceToken,
        sourceAmount, nonce, gas, gasPrice, keystring, password, type, address, networkId)
    } catch (e) {
      console.log(e)
      yield put(actions.throwPassphraseError(e.message))
      return
    }
    try {
      yield put(actions.prePareBroadcast(balanceData))
      var txRaw
      try {
        var hashApprove = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", rawApprove);

        yield put(actions.setApproveTx(hashApprove, sourceTokenSymbol))
        console.log("approve: " + hashApprove)
        //increase nonce
        yield put(incManualNonceAccount(account.address))
        nonce++

        txRaw = yield callService(
          "tokenToOthersFromAccount", "tokenToOthersPayment",
          keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount,
          minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
        );

        yield put(actions.prePareBroadcast(balanceData))
      } catch (e) {
        console.log(e)
        yield call(doTxFail, ethereum, account, e.message)
        return
      }

      var response = yield call(doBeforeMakeTransaction, txRaw)
      console.log(response)

      var hash = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", txRaw)
      yield call(runAfterBroadcastTx, ethereum, txRaw, hash, account, data)
    } catch (e) {
      console.log(e)
      yield call(doTxFail, ethereum, account, e.message)
      return
    }
  } else {
    var txRaw

    try {
      txRaw = yield callService(
        "tokenToOthersFromAccount", "tokenToOthersPayment",
        keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount,
        minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
      );
    } catch (e) {
      console.log(e)
      yield put(actions.throwPassphraseError(e.message))
      return
    }
    try {
      yield put(actions.prePareBroadcast(balanceData))

      var response = yield call(doBeforeMakeTransaction, txRaw)
      console.log(response)

      const hash = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", txRaw)
      yield call(runAfterBroadcastTx, ethereum, txRaw, hash, account, data)
    } catch (e) {
      console.log(e)
      yield call(doTxFail, ethereum, account, e.message)
      return
    }
  }
}
export function* exchangeTokentoETHPrivateKey(action) {
  var {
    formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
    nonce, gas, gasPrice, keystring, type, password, account, data, keyService, balanceData,
    sourceTokenSymbol, blockNo, paymentData, hint } = action.payload;

  var networkId = common.getNetworkId()
  const isPayMode = checkIsPayMode();

  try {
    var remainStr = yield call([ethereum, ethereum.call], "getAllowanceAtLatestBlock", sourceToken, address, isPayMode)
    var remain = converter.hexToBigNumber(remainStr)
    var sourceAmountBig = converter.hexToBigNumber(sourceAmount)

    if (!remain.isGreaterThanOrEqualTo(sourceAmountBig) && !isApproveTxPending()) {
      let rawApprove
      try {
        rawApprove = yield call(keyService.callSignTransaction, "getAppoveToken", isPayMode, ethereum, sourceToken,
          sourceAmount, nonce, gas, gasPrice, keystring, password, type, address, networkId)
      } catch (e) {
        yield put(actions.setSignError(e.message))
        return
      }

      yield put(actions.prePareBroadcast(balanceData))

      try {
        var hashApprove = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", rawApprove)
        yield put(actions.setApproveTx(hashApprove, sourceTokenSymbol))
        console.log(hashApprove)
        //increase nonce
        yield put(incManualNonceAccount(account.address))
        nonce++
      } catch (e) {
        console.log(e)
        yield call(doTxFail, ethereum, account, e.message)
        return
      }
    }

    var txRaw

    try {
      txRaw = yield callService(
        "tokenToOthersFromAccount", "tokenToOthersPayment",
        keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount,
        minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
      );
    } catch (e) {
      yield put(actions.setSignError(e.message))
      return
    }
    yield put(actions.prePareBroadcast(balanceData))

    var response = yield call(doBeforeMakeTransaction, txRaw)
    console.log(response)

    var hash = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", txRaw)
    yield call(runAfterBroadcastTx, ethereum, txRaw, hash, account, data)
  } catch (e) {
    console.log(e)
    yield call(doTxFail, ethereum, account, e.message)
    return
  }
}

function* exchangeTokentoETHColdWallet(action) {
  const {
    formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
    nonce, gas, gasPrice, keystring, type, password, account, data, keyService, balanceData,
    blockNo, paymentData, hint } = action.payload;

  var networkId = common.getNetworkId()

  try {
    let txRaw

    try {
      txRaw = yield callService(
        "tokenToOthersFromAccount", "tokenToOthersPayment",
        keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount,
        minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
      );
    } catch (e) {
      console.log(e)
      let msg = ''
      if (isLedgerError(type, e)) {
        msg = keyService.getLedgerError(e)
      } else {
        msg = e.message
      }
      yield put(actions.setSignError(msg))
      return
    }

    yield put(actions.prePareBroadcast(balanceData))

    var response = yield call(doBeforeMakeTransaction, txRaw)
    console.log(response)

    const hash = yield call([ethereum, ethereum.callMultiNode], "sendRawTransaction", txRaw)
    yield call(runAfterBroadcastTx, ethereum, txRaw, hash, account, data)
  } catch (e) {
    yield call(doTxFail, ethereum, account, e.message)
    return
  }
}

export function* exchangeTokentoETHMetamask(action) {
  const {
    formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
    nonce, gas, gasPrice, keystring, type, password, account, data, keyService, balanceData,
    blockNo, paymentData, hint } = action.payload

  var networkId = common.getNetworkId()

  try {
    var hash

    try {
      hash = yield callService(
        "tokenToOthersFromAccount", "tokenToOthersPayment",
        keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress, maxDestAmount,
        minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
      );
    } catch (e) {
      yield put(actions.setSignError(e))
      return
    }

    yield put(actions.prePareBroadcast(balanceData))
    const txRaw = { gas, gasPrice, nonce }
    yield call(runAfterBroadcastTx, ethereum, txRaw, hash, account, data)
  } catch (e) {
    console.log(e)
    yield call(doTxFail, ethereum, account, e.message)
    return
  }
}

function* callService(
  swapMethod, paymentMethod, keyService, formId, ethereum, address, sourceToken, sourceAmount, destToken, destAddress,
  maxDestAmount, minConversionRate, blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, paymentData, hint
) {
  let toContract;

  if (checkIsPayMode()) {
    toContract = common.getPayWrapperAddress();

    return yield call(
      keyService.callSignTransaction, paymentMethod, formId, ethereum, address,
      sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
      blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, toContract, paymentData, hint
    )
  } else {
    toContract = common.getKyberAddress();

    return yield call(keyService.callSignTransaction, swapMethod, formId, ethereum, address,
      sourceToken, sourceAmount, destToken, destAddress, maxDestAmount, minConversionRate,
      blockNo, nonce, gas, gasPrice, keystring, type, password, networkId, toContract
    )
  }
}

function* getRate(ethereum, source, dest, sourceAmount) {
  try {
    //get latestblock
    const lastestBlock = yield call([ethereum, ethereum.call], "getLatestBlock")
    const rate = yield call([ethereum, ethereum.call], "getRateAtSpecificBlock", source, dest, sourceAmount, lastestBlock)
    const expectedPrice = rate.expectedPrice ? rate.expectedPrice : "0"
    const slippagePrice = rate.slippagePrice ? rate.slippagePrice : "0"
    return { status: "success", res: { expectedPrice, slippagePrice, lastestBlock } }
  }
  catch (err) {
    console.log(err)
    return { status: "fail" }
  }
}

function* getSourceAmount(sourceTokenSymbol, sourceAmount) {
  var state = store.getState()
  var tokens = state.tokens.tokens

  var sourceAmountHex = "0x0"
  if (tokens[sourceTokenSymbol]) {
    var decimals = tokens[sourceTokenSymbol].decimals
    var rateSell = tokens[sourceTokenSymbol].rate
    sourceAmountHex = converter.calculateMinSource(sourceTokenSymbol, sourceAmount, decimals, rateSell)
  } else {
    sourceAmountHex = converter.stringToHex(sourceAmount, 18)
  }
  return sourceAmountHex
}

function* getSourceAmountZero(sourceTokenSymbol) {
  var state = store.getState()
  var tokens = state.tokens.tokens
  var sourceAmountHex = "0x0"
  if (tokens[sourceTokenSymbol]) {
    var decimals = tokens[sourceTokenSymbol].decimals
    var rateSell = tokens[sourceTokenSymbol].rate
    sourceAmountHex = converter.toHex(converter.getSourceAmountZero(sourceTokenSymbol, decimals, rateSell))
  }
  return sourceAmountHex
}

function* updateRatePending(action) {
  const { source, dest, sourceAmount, sourceTokenSymbol, isManual } = action.payload
  var state = store.getState()
  var ethereum = state.connection.ethereum
  var translate = getTranslate(state.locale)



  var sourceAmoutRefined = yield call(getSourceAmount, sourceTokenSymbol, sourceAmount)
  var sourceAmoutZero = yield call(getSourceAmountZero, sourceTokenSymbol)
  console.log({ sourceAmoutRefined, sourceAmoutZero })
  if (isManual) {
    var rateRequest = yield call(common.handleRequest, getRate, ethereum, source, dest, sourceAmoutRefined)
    if (rateRequest.status === "success") {
      var { expectedPrice, slippagePrice, lastestBlock } = rateRequest.data
      var rateInit = expectedPrice.toString()
      if (expectedPrice.toString() === "0") {
        var rateRequestZeroAmount = yield call(common.handleRequest, getRate, ethereum, source, dest, sourceAmoutZero)

        if (rateRequestZeroAmount.status === "success") {
          rateInit = rateRequestZeroAmount.data.expectedPrice
        }
        if (rateRequestZeroAmount.status === "timeout") {
          yield put(utilActions.openInfoModal(translate("error.error_occurred") || "Error occurred",
            translate("error.node_error") || "There are some problems with nodes. Please try again in a while."))
          return
        }
        if (rateRequestZeroAmount.status === "fail") {
          yield put(utilActions.openInfoModal(translate("error.error_occurred") || "Error occurred",
            translate("error.network_error") || "Cannot connect to node right now. Please check your network!"))
          return
        }
      }
      yield put.sync(actions.updateRateExchangeComplete(rateInit, expectedPrice, slippagePrice, lastestBlock, isManual, true))
    }

    if (rateRequest.status === "timeout") {
      yield put(utilActions.openInfoModal(translate("error.error_occurred") || "Error occurred",
        translate("error.node_error") || "There are some problems with nodes. Please try again in a while."))
    }
    if (rateRequest.status === "fail") {
      yield put(utilActions.openInfoModal(translate("error.error_occurred") || "Error occurred",
        translate("error.network_error") || "Cannot connect to node right now. Please check your network!"))
    }
  } else {
    const rateRequest = yield call(getRate, ethereum, source, dest, sourceAmoutRefined)
    if (rateRequest.status === "success") {
      var { expectedPrice, slippagePrice, lastestBlock } = rateRequest.res
      var rateInit = expectedPrice.toString()
      if (expectedPrice.toString() === "0") {
        var rateRequestZeroAmount = yield call(common.handleRequest, getRate, ethereum, source, dest, sourceAmoutZero)

        if (rateRequestZeroAmount.status === "success") {
          rateInit = rateRequestZeroAmount.data.expectedPrice
        }
        if (rateRequestZeroAmount.status === "timeout") {
          yield put(utilActions.openInfoModal(translate("error.error_occurred") || "Error occurred",
            translate("error.node_error") || "There are some problems with nodes. Please try again in a while."))
          return
        }
        if (rateRequestZeroAmount.status === "fail") {
          yield put(utilActions.openInfoModal(translate("error.error_occurred") || "Error occurred",
            translate("error.network_error") || "Cannot connect to node right now. Please check your network!"))
          return
        }
      }

      yield put.sync(actions.updateRateExchangeComplete(rateInit, expectedPrice, slippagePrice, lastestBlock, isManual, true))
    }
  }
}



function* getRateSnapshot(ethereum, source, dest, sourceAmountHex) {
  try {
    var rate = yield call([ethereum, ethereum.call], "getRate", source, dest, sourceAmountHex)
    return { status: "success", res: rate }
  } catch (e) {
    console.log(e)
    return { status: "fail", err: e }
  }
}
function* updateRateSnapshot(action) {
  const ethereum = action.payload
  var state = store.getState()
  var exchangeSnapshot = state.exchange.snapshot
  var translate = getTranslate(state.locale)
  try {
    var source = exchangeSnapshot.sourceToken
    var dest = exchangeSnapshot.destToken
    var sourceAmount

    if (exchangeSnapshot.isHaveDestAmount) {
      sourceAmount = converter.caculateSourceAmount(exchangeSnapshot.destAmount, exchangeSnapshot.offeredRate, 6)
    } else {
      sourceAmount = exchangeSnapshot.sourceAmount
    }

    var sourceDecimal = exchangeSnapshot.sourceDecimal
    var sourceAmountHex = converter.stringToHex(sourceAmount, sourceDecimal)
    var rateInit = 0
    var rateRequest = yield call(common.handleRequest, getRateSnapshot, ethereum, source, dest, sourceAmountHex)

    if (rateRequest.status === "success") {
      var rate = rateRequest.data
      var expectedPrice = rate.expectedRate ? rate.expectedRate : "0"
      var slippagePrice = rate.slippageRate ? rate.slippageRate : "0"
      if (expectedPrice == 0) {
        yield put(utilActions.openInfoModal(translate("error.error_occurred") || "Error occurred",
          translate("error.node_error") || "There are some problems with nodes. Please try again in a while."))
        yield put(actions.hideApprove())
        yield put(actions.hideConfirm())
        yield put(actions.hidePassphrase())
      } else {
        yield put.sync(actions.updateRateSnapshotComplete(rateInit, expectedPrice, slippagePrice))
        yield put(actions.caculateAmountInSnapshot())
      }
    } else {
      yield put(actions.hideApprove())
      yield put(actions.hideConfirm())
      yield put(actions.hidePassphrase())
    }
    var title = translate("error.error_occurred") || "Error occurred"
    var content = ''
    if (rateRequest.status === "timeout") {
      content = translate("error.node_error") || "There are some problems with nodes. Please try again in a while."
      yield put(utilActions.openInfoModal(title, content))
    }
    if (rateRequest.status === "fail") {
      content = translate("error.network_error") || "Cannot connect to node right now. Please check your network!"
      yield put(utilActions.openInfoModal(title, content))
    }
  }
  catch (err) {
    console.log("===================")
    console.log(err)
  }
}

function* estimateGas() {

  var gasRequest = yield call(common.handleRequest, getGasUsed)
  if (gasRequest.status === "success") {
    const { gas, gas_approve } = gasRequest.data
    yield put(actions.setEstimateGas(gas, gas_approve))
  }
  if ((gasRequest.status === "timeout") || (gasRequest.status === "fail")) {
    console.log("timeout")
    var state = store.getState()
    const exchange = state.exchange

    const sourceTokenSymbol = exchange.sourceTokenSymbol
    var gas = yield call(getMaxGasExchange)
    var gas_approve
    if (sourceTokenSymbol === "ETH") {
      gas_approve = 0
    } else {
      gas_approve = yield call(getMaxGasApprove)
    }

    yield put(actions.setEstimateGas(gas, gas_approve))
  }
}

function* estimateGasSnapshot() {

  var gasRequest = yield call(common.handleRequest, getGasUsed)
  console.log("gas_request:" + JSON.stringify(gasRequest))
  if (gasRequest.status === "success") {
    const { gas, gas_approve } = gasRequest.data
    yield put(actions.setEstimateGasSnapshot(gas, gas_approve))
  }
  if ((gasRequest.status === "timeout") || (gasRequest.status === "fail")) {
    console.log("timeout")
    var state = store.getState()
    const exchange = state.exchange

    const sourceTokenSymbol = exchange.sourceTokenSymbol
    var gas = yield call(getMaxGasExchange)
    var gas_approve
    if (sourceTokenSymbol === "ETH") {
      gas_approve = 0
    } else {
      gas_approve = yield call(getMaxGasApprove)
    }

    yield put(actions.setEstimateGasSnapshot(gas, gas_approve))
  }
}

function* fetchGasConfirmSnapshot() {
  var state = store.getState()
  var gas
  var gas_approve = 0

  var gasRequest = yield call(common.handleRequest, getGasConfirm)
  if (gasRequest.status === "success") {
    const gas = gasRequest.data
    yield put(actions.setEstimateGasSnapshot(gas, gas_approve))
  }
  if ((gasRequest.status === "timeout") || (gasRequest.status === "fail")) {
    console.log("timeout")

    gas = yield call(getMaxGasExchange)
    yield put(actions.setEstimateGasSnapshot(gas, gas_approve))
  }

  yield put(actions.fetchGasSuccessSnapshot())
}

function* fetchGasApproveSnapshot() {
  var gas = yield call(getMaxGasExchange)
  var gas_approve

  var gasRequest = yield call(common.handleRequest, getGasApprove)
  if (gasRequest.status === "success") {
    const gas_approve = gasRequest.data
    yield put(actions.setEstimateGasSnapshot(gas, gas_approve))
  }
  if ((gasRequest.status === "timeout") || (gasRequest.status === "fail")) {
    console.log("timeout")

    gas_approve = yield call(getMaxGasApprove)
    yield put(actions.setEstimateGasSnapshot(gas, gas_approve))
  }

  yield put(actions.fetchGasSuccessSnapshot())
}


function* getMaxGasExchange(source, dest) {
  var state = store.getState()
  const exchange = state.exchange
  const tokens = state.tokens.tokens

  var sourceTokenLimit = tokens[source].gasLimit
  var destTokenLimit = tokens[dest].gasLimit

  var sourceGasLimit = sourceTokenLimit || sourceTokenLimit === 0 ? parseInt(sourceTokenLimit) : exchange.max_gas
  var destGasLimit = destTokenLimit || destTokenLimit === 0 ? parseInt(destTokenLimit) : exchange.max_gas

  return sourceGasLimit + destGasLimit
}

function* getMaxGasApprove(tokenGasApprove) {  
  return tokenGasApprove ? tokenGasApprove : 100000;
}

function* getGasConfirm() {
  var state = store.getState()
  const ethereum = state.connection.ethereum
  const exchange = state.exchange
  const kyber_address = BLOCKCHAIN_INFO.network
  const maxGas = yield call(getMaxGasExchange)
  var gas = maxGas
  var account = state.account.account
  var address = account.address
  var tokens = state.tokens.tokens
  var sourceDecimal = 18
  var sourceTokenSymbol = exchange.sourceTokenSymbol

  if (tokens[sourceTokenSymbol]) {
    sourceDecimal = tokens[sourceTokenSymbol].decimals
  }

  const sourceToken = exchange.sourceToken
  const sourceAmount = converter.stringToHex(exchange.sourceAmount, sourceDecimal)
  const destToken = exchange.destToken
  const maxDestAmount = converter.biggestNumber()
  const minConversionRate = converter.numberToHex(converter.toTWei(exchange.slippageRate, 18))
  const blockNo = converter.numberToHexAddress(exchange.blockNo)
  const paymentData = exchange.paymentData;
  const hint = exchange.hint;
  var data

  if (checkIsPayMode()) {
    data = yield call([ethereum, ethereum.call], "getPaymentEncodedData", sourceToken, sourceAmount,
      destToken, address, maxDestAmount, minConversionRate, blockNo, paymentData, hint)
  } else {
    data = yield call([ethereum, ethereum.call], "exchangeData", sourceToken, sourceAmount,
      destToken, address, maxDestAmount, minConversionRate, blockNo)
  }

  var gas = 0

  var value = '0x0'
  if (exchange.sourceTokenSymbol === 'ETH') {
    value = sourceAmount
  }

  var txObj = {
    from: address,
    to: kyber_address,
    data: data,
    value: value
  }

  try {
    gas = yield call([ethereum, ethereum.call], "estimateGas", txObj)
    gas = Math.round(gas * 120 / 100)
    if (gas > maxGas) {
      gas = maxGas
    }
    return { status: "success", res: gas }
  } catch (e) {
    console.log(e)
    return { status: "fail", err: e }
  }


}

function* getGasApprove() {
  var state = store.getState()
  const ethereum = state.connection.ethereum
  const exchange = state.exchange
  const sourceToken = exchange.sourceToken

  var account = state.account.account
  var address = account.address

  const maxGasApprove = yield call(getMaxGasApprove)
  var gas_approve = 0
  const isPayMode = checkIsPayMode();

  try {
    var dataApprove = yield call([ethereum, ethereum.call], "approveTokenData", sourceToken, converter.biggestNumber(), isPayMode)
    var txObjApprove = {
      from: address,
      to: sourceToken,
      data: dataApprove,
      value: '0x0',
    }
    gas_approve = yield call([ethereum, ethereum.call], "estimateGas", txObjApprove)
    gas_approve = Math.round(gas_approve * 120 / 100)
    if (gas_approve > maxGasApprove) {
      gas_approve = maxGasApprove
    }
    return { status: "success", res: gas_approve }
  } catch (e) {
    console.log(e)
    return { status: "fail", err: e }
  }

}

function* getGasUsed() {
  var state = store.getState()
  const ethereum = state.connection.ethereum
  const exchange = state.exchange
  const kyber_address = BLOCKCHAIN_INFO[exchange.network].network
  const maxGas = yield call(getMaxGasExchange)
  const maxGasApprove = yield call(getMaxGasApprove)
  var gas = maxGas
  var gas_approve = 0
  var account = state.account.account
  var address = account.address
  var tokens = state.tokens.tokens
  var sourceDecimal = 18
  var sourceTokenSymbol = exchange.sourceTokenSymbol

  if (tokens[sourceTokenSymbol]) {
    sourceDecimal = tokens[sourceTokenSymbol].decimals
  }

  try {
    const sourceToken = exchange.sourceToken
    const sourceAmount = converter.stringToHex(exchange.sourceAmount, sourceDecimal)
    const destToken = exchange.destToken
    const maxDestAmount = converter.biggestNumber()
    const minConversionRate = converter.numberToHex(converter.toTWei(exchange.slippageRate, 18))
    const blockNo = converter.numberToHexAddress(exchange.blockNo)
    const paymentData = exchange.paymentData;
    const hint = exchange.hint;
    var data

    if (checkIsPayMode()) {
      data = yield call([ethereum, ethereum.call], "getPaymentEncodedData", sourceToken, sourceAmount,
        destToken, address, maxDestAmount, minConversionRate, blockNo, paymentData, hint)
    } else {
      data = yield call([ethereum, ethereum.call], "exchangeData", sourceToken, sourceAmount,
        destToken, address, maxDestAmount, minConversionRate, blockNo)
    }

    var value = '0'
    if (exchange.sourceTokenSymbol === 'ETH') {
      value = sourceAmount
    } else {
      const isPayMode = checkIsPayMode();
      //calculate gas approve
      const remainStr = yield call([ethereum, ethereum.call], "getAllowanceAtLatestBlock", sourceToken, address, isPayMode)
      const remain = converter.hexToBigNumber(remainStr)
      const sourceAmountBig = converter.hexToBigNumber(sourceAmount)

      if (!remain.isGreaterThanOrEqualTo(sourceAmountBig)) {
        //calcualte gas approve
        var dataApprove = yield call([ethereum, ethereum.call], "approveTokenData", sourceToken, converter.biggestNumber(), isPayMode)
        var txObjApprove = {
          from: address,
          to: sourceToken,
          data: dataApprove,
          value: '0x0',
        }
        gas_approve = yield call([ethereum, ethereum.call], "estimateGas", txObjApprove)
        gas_approve = Math.round(gas_approve * 120 / 100)
        if (gas_approve > maxGasApprove) {
          gas_approve = maxGasApprove
        }
      } else {
        gas_approve = 0
      }
    }
    var txObj = {
      from: address,
      to: kyber_address,
      data: data,
      value: value
    }

    gas = yield call([ethereum, ethereum.call], "estimateGas", txObj)
    console.log("get_gas:" + gas)
    gas = Math.round(gas * 120 / 100)
    if (gas > maxGas) {
      gas = maxGas
    }

    return { status: "success", res: { gas, gas_approve } }
  } catch (e) {
    console.log("Cannot estimate gas")
    console.log(e)
    return { status: "fail", err: e }
  }
}

function* analyzeError(action) {
  const { ethereum, txHash } = action.payload
  try {
    var tx = yield call([ethereum, ethereum.call], "getTx", txHash)
    var value = tx.value
    var owner = tx.from
    var gas_price = tx.gasPrice
    var blockNumber = tx.blockNumber
    var result = yield call([ethereum, ethereum.call], "exactTradeData", tx.input)
    var source = result[0].value
    var srcAmount = result[1].value
    var dest = result[2].value
    var destAddress = result[3].value
    var maxDestAmount = result[4].value
    var minConversionRate = result[5].value
    var walletID = result[6].value
    var reserves = yield call([ethereum, ethereum.call], "getListReserve")
    var receipt = yield call([ethereum, ethereum.call], 'txMined', txHash)
    var transaction = {
      gasUsed: receipt.gasUsed,
      status: receipt.status,
      gas: tx.gas
    }
    var input = {
      value, owner, gas_price, source, srcAmount, dest,
      destAddress, maxDestAmount, minConversionRate, walletID, reserves, txHash, transaction
    }

    console.log(input)
    yield call(debug, input, blockNumber, ethereum)
  } catch (e) {
    console.log(e)
    yield put(actions.setAnalyzeError({}, txHash))
  }
}

function* debug(input, blockno, ethereum) {
  var networkIssues = {}
  var translate = getTranslate(store.getState().locale)
  var gasCap = yield call([ethereum, ethereum.call], "wrapperGetGasCap", blockno)

  if (input.transaction.gasUsed === input.transaction.gas && !input.transaction.status) networkIssues["gas_used"] = "Your transaction is run out of gas"

  if (converter.compareTwoNumber(input.gas_price, gasCap) === 1) {
    networkIssues["gas_price"] = translate('error.gas_price_exceeded_limit') || "Gas price exceeded max limit"
  }
  if (input.source !== constants.ETHER_ADDRESS) {
    if (converter.compareTwoNumber(input.value, 0) === 1) {
      networkIssues["token_ether"] = translate('error.issue_token_ether') || "Failed because of sending ether along the tx when it is trying to trade token to ether"
    }
    var remainStr = yield call([ethereum, ethereum.call], "getAllowanceAtSpecificBlock", input.source, input.owner, blockno)
    if (converter.compareTwoNumber(remainStr, input.srcAmount) === -1) {
      networkIssues["allowance"] = translate('error.issue_allowance') || "Failed because allowance is lower than srcAmount"
    }
    var balance = yield call([ethereum, ethereum.call], "getTokenBalanceAtSpecificBlock", input.source, input.owner, blockno)
    if (converter.compareTwoNumber(balance, input.srcAmount) === -1) {
      networkIssues["balance"] = translate('error.issue_balance') || "Failed because token balance is lower than srcAmount"
    }
  } else {
    if (converter.compareTwoNumber(input.value, input.srcAmount) !== 0) {
      networkIssues["ether_amount"] = translate('error.issue_ether_amount') || "Failed because the user didn't send the exact amount of ether along"
    }
  }

  if (input.source === constants.ETHER_ADDRESS) {
    var userCap = yield call([ethereum, ethereum.call], "getMaxCapAtSpecificBlock", input.owner, blockno)
    if (converter.compareTwoNumber(input.srcAmount, userCap) === 1) {
      networkIssues["user_cap"] = translate('error.issue_user_cap') || "Failed because the source amount exceeded user cap"
    }
  }

  if (input.dest === constants.ETHER_ADDRESS) {
    var userCap = yield call([ethereum, ethereum.call], "getMaxCapAtSpecificBlock", input.owner, blockno)
    if (input.destAmount > userCap) {
      networkIssues["user_cap"] = translate('error.issue_user_cap') || "Failed because the source amount exceeded user cap"
    }
  }

  //Reserve scops
  var rates = yield call([ethereum, ethereum.call], "getRateAtSpecificBlock", input.source, input.dest, input.srcAmount, blockno)
  if (converter.compareTwoNumber(rates.expectedPrice, 0) === 0) {
    var reasons = yield call([ethereum, ethereum.call], "wrapperGetReasons", input.reserves[0], input, blockno)
    networkIssues["rateError"] = reasons
  } else {
    console.log(rates)
    console.log(input.minConversionRate)
    if (converter.compareTwoNumber(input.minConversionRate, rates.expectedPrice) === 1) {
      networkIssues["rateZero"] = translate('error.min_rate_too_high') || "Your min rate is too high!"
    }
  }

  yield put(actions.setAnalyzeError(networkIssues, input.txHash))
}

function* checkKyberEnable() {
  var state = store.getState()
  const ethereum = state.connection.ethereum
  try {
    var enabled = yield call([ethereum, ethereum.call], "checkKyberEnable")
    yield put(actions.setKyberEnable(enabled))
  } catch (e) {
    console.log(e.message)
    yield put(actions.setKyberEnable(false))
  }

}

function* verifyExchange() {
  var state = store.getState()
  const exchange = state.exchange
  const tokens = state.tokens.tokens
  const translate = getTranslate(state.locale)
  var srcAmount
  var sourceTokenSymbol = exchange.sourceTokenSymbol

  if (sourceTokenSymbol !== "ETH") {
    if (tokens[sourceTokenSymbol].rate == 0) {
      yield put(actions.throwErrorExchange("src_small", ""))
      return
    }
  }

  if (exchange.isHaveDestAmount) {
    var offeredRate = exchange.offeredRate
    srcAmount = converter.caculateSourceAmount(exchange.destAmount, offeredRate, 6)
    srcAmount = converter.toTWei(srcAmount, tokens[sourceTokenSymbol].decimals)
  } else {
    srcAmount = exchange.sourceAmount
    srcAmount = converter.toTWei(srcAmount, tokens[sourceTokenSymbol].decimals)
  }

  if (sourceTokenSymbol !== "ETH") {
    var rate = tokens[sourceTokenSymbol].rate
    var decimals = tokens[sourceTokenSymbol].decimals
    srcAmount = converter.toT(srcAmount, decimals)
    srcAmount = converter.caculateDestAmount(srcAmount, rate, 6)
    srcAmount = converter.toTWei(srcAmount, 18)
  }

  if (converter.compareTwoNumber(srcAmount, constansts.EPSILON) === -1) {
    var minAmount = converter.toEther(constansts.EPSILON)
    yield put(actions.throwErrorExchange("src_small", translate("error.source_amount_too_small", { minAmount: minAmount }) || `Source amount is too small. Minimum amount is ${minAmount} ETH equivalent.`))
  } else {
    yield put(actions.throwErrorExchange("src_small", ""))
  }
}


export function* fetchExchangeEnable() {
  var enableRequest = yield call(common.handleRequest, getExchangeEnable)
  if (enableRequest.status === "success") {
    var state = store.getState()
    var exchange = state.exchange
    console.log(enableRequest)
    if (enableRequest.data === true && exchange.errors.exchange_enable === "") {
      var translate = getTranslate(state.locale)
      var kycLink = "https://account.kyber.network/users/sign_up"
      yield put(utilActions.openInfoModal(translate("error.error_occurred") || "Error occurred",
        translate("error.exceed_daily_volumn", { link: kycLink }) || "You may want to register with us to have higher trade limits " + kycLink))
    }
    yield put(actions.setExchangeEnable(enableRequest.data))
  }
  if ((enableRequest.status === "timeout") || (enableRequest.status === "fail")) {
    yield put(actions.setExchangeEnable(false))
  }
}

export function* getExchangeEnable() {
  var state = store.getState()

  const ethereum = state.connection.ethereum

  var account = state.account.account
  var address = account.address

  try {
    var enabled = yield call([ethereum, ethereum.call], "getExchangeEnable", address)
    return { status: "success", res: enabled }
  } catch (e) {
    console.log(e.message)
    return { status: "success", res: false }
  }
}

export function* initParamsExchange(action) {
  var state = store.getState()
  var exchange = state.exchange
  var sourceTokenSymbol = exchange.sourceTokenSymbol
  var source = exchange.sourceToken

  const { receiveToken, tokenAddr, receiveAmount, network, type, defaultPairArr, tokens } = action.payload

  var ethereum = new EthereumService({ network })


  if (type === 'swap' && defaultPairArr.length === 2){
    sourceTokenSymbol = defaultPairArr[0]
    source = tokens[sourceTokenSymbol].address
    var destSymbol = defaultPairArr[1]
    var destAddress = tokens[destSymbol].address
    yield put.sync(actions.changeDefaultTokens(sourceTokenSymbol, source, destSymbol, destAddress))
  }

  yield put.sync(setConnection(ethereum))

  if (type === 'buy') {
    if (receiveToken === 'ETH') {
      sourceTokenSymbol = 'KNC'
      source = tokens['KNC'].address
      yield put.sync(actions.updateSourceToken(sourceTokenSymbol, source))
    }
  }

  yield call(estimateGasUsed, sourceTokenSymbol, receiveToken)
  var dest = tokenAddr

  if (receiveAmount) {
    try {
      if (receiveToken === "ETH") {
        if (parseFloat(receiveAmount) > constants.MAX_AMOUNT_RATE_HANDLE) {
          yield put(actions.throwErrorHandleAmount())
          return
        }
      } else {
        var rateETH = yield call([ethereum, ethereum.call], "getRate", tokens["ETH"].address, tokenAddr, "0x0")
        var destValue = converter.caculateSourceAmount(receiveAmount, rateETH.expectedRate, 6)
        if (parseFloat(destValue) > constants.MAX_AMOUNT_RATE_HANDLE) {
          yield put(actions.throwErrorHandleAmount())
          return
        }
      }

      if (sourceTokenSymbol !== receiveToken) {
        var rate = yield call([ethereum, ethereum.call], "getRate", source, dest, "0x0")

        var sourceAmount = converter.caculateSourceAmount(receiveAmount, rate.expectedRate, 6)
        yield put(actions.updateRateExchange(source, dest, sourceAmount, sourceTokenSymbol, true))
      }


    } catch (e) {
      console.log(e)
      yield put(actions.updateRateExchange(source, dest, 0, sourceTokenSymbol, true))
    }
  } else {
    yield put(actions.updateRateExchange(source, dest, 0, sourceTokenSymbol, true))
  }

  ethereum.subcribe()


  const web3Service = web3Package.newWeb3Instance()
  if(web3Service !== false){
    const watchMetamask = yield fork(watchMetamaskAccount, ethereum, web3Service, network)
    yield take('GLOBAL.INIT_SESSION')
    yield cancel(watchMetamask)
  }else{
    yield put(globalActions.throwErrorMematamask("Metamask is not installed"))
  }

  var notiService = new NotiService({ type: "session" })
  yield put(globalActions.setNotiHandler(notiService))
}


function* watchMetamaskAccount(ethereum, web3Service, network) {
  var translate = getTranslate(store.getState().locale)
  while (true) {
    try {
      var state = store.getState()
      if (!commonFunc.checkComponentExist(state.global.params.appId)) {
        return
      }
      const account = state.account.account
      if (account === false) {
        const currentId = yield call([web3Service, web3Service.getNetworkId])
        const networkId = BLOCKCHAIN_INFO[network].networkId
        if (parseInt(currentId, 10) !== networkId) {
          const currentName = commonFunc.findNetworkName(parseInt(currentId, 10))
          const expectedName = commonFunc.findNetworkName(networkId)
          yield put(globalActions.throwErrorMematamask(translate("error.network_not_match", { expectedName: expectedName, currentName: currentName }) || `Metamask should be on ${expectedName}. Currently on ${currentName}`))
          return
        }

        try {
          const coinbase = yield call([web3Service, web3Service.getCoinbase])
          const balanceBig = yield call([ethereum, ethereum.call], "getBalanceAtLatestBlock", coinbase)
          const balance = converter.roundingNumber(converter.toEther(balanceBig))
          yield put(globalActions.updateMetamaskAccount(coinbase, balance))
        } catch (e) {
          console.log(e)
          yield put(globalActions.throwErrorMematamask(translate("error.cannot_connect_metamask") || `Cannot get metamask account. You probably did not login in Metamask`))
        }
      }
    } catch (e) {
      console.log(e)
      yield put(globalActions.throwErrorMematamask(e.message))
    }

    yield call(delay, 5000)
  }
}

function isLedgerError(accountType, error) {
  return accountType === "ledger" && error.hasOwnProperty("statusCode");
}

function checkIsPayMode() {
  const state = store.getState();

  return !state.exchange.isSwap;
}

export function* watchExchange() {
  yield takeEvery("EXCHANGE.APPROVAL_TX_BROADCAST_PENDING", approveTx)
  yield takeEvery("EXCHANGE.PROCESS_EXCHANGE", processExchange)
  yield takeEvery("EXCHANGE.PROCESS_APPROVE", processApprove)
  yield takeEvery("EXCHANGE.CHECK_TOKEN_BALANCE_COLD_WALLET", checkTokenBalanceOfColdWallet)
  yield takeEvery("EXCHANGE.UPDATE_RATE_PENDING", updateRatePending)
  yield takeEvery("EXCHANGE.UPDATE_RATE_SNAPSHOT", updateRateSnapshot)
  yield takeEvery("EXCHANGE.ESTIMATE_GAS_USED", estimateGasUsed)
  yield takeEvery("EXCHANGE.ANALYZE_ERROR", analyzeError)
  yield takeEvery("EXCHANGE.SELECT_TOKEN_ASYNC", selectToken)
  yield takeEvery("EXCHANGE.CHECK_KYBER_ENABLE", checkKyberEnable)
  yield takeEvery("EXCHANGE.VERIFY_EXCHANGE", verifyExchange)
  yield takeEvery("EXCHANGE.FETCH_EXCHANGE_ENABLE", fetchExchangeEnable)
  yield takeEvery("EXCHANGE.INIT_PARAMS_EXCHANGE", initParamsExchange)
  yield takeEvery("EXCHANGE.SWAP_TOKEN", swapToken)
}
