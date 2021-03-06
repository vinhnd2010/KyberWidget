
import React from 'react';
// import HttpEthereumProvider from "./httpProvider"
// import WebsocketEthereumProvider from "./wsProvider"
import constants from "../constants"

import {
  updateBlock, updateBlockFailed, updateRate, updateAllRate, updateAllRateUSD,
  checkConnection, setGasPrice, setMaxGasPrice
} from "../../actions/globalActions"
import { updateAccount, updateTokenBalance } from "../../actions/accountActions"
import { updateTx, updateApproveTxsData } from "../../actions/txActions"
import { updateRateExchange, estimateGas, analyzeError, checkKyberEnable, verifyExchange, caculateAmount, fetchExchangeEnable, throwErrorHandleAmount } from "../../actions/exchangeActions"
import { estimateGasTransfer, verifyTransfer } from "../../actions/transferActions"

import * as marketActions from "../../actions/marketActions"

import BLOCKCHAIN_INFO from "../../../../env"
import { store } from "../../store"
import { setConnection } from "../../actions/connectionActions"
import * as converter from "../../utils/converter"

import * as providers from "./nodeProviders"

import * as common from "../../utils/common"


export default class EthereumService extends React.Component {
  constructor(props) {
    super(props)

    // this.listProviders = BLOCKCHAIN_INFO.connections.http.filter(node => {
    //   console.log
    //   switch (node.type) {
    //     case "cached":
    //       return new providers.CachedServerProvider({ url: node.endPoint })
    //       break
    //     case "prune":
    //       return new providers.PruneProvider({ url: node.endPoint })
    //       break
    //     case "none_prune":
    //       return new providers.NonePruneProvider({ url: node.endPoint })
    //       break
    //   }
    // })
    console.log("network_name")
    console.log(props.network)
    
    this.network = props.network

    this.listProviders = []
    for (var node of BLOCKCHAIN_INFO[this.network].connections.http) {
      switch (node.type) {
        case "cached":
          var provider = new providers.CachedServerProvider({ url: node.endPoint, network: this.network })
          this.listProviders.push(provider)
          break
        case "prune":
          var provider = new providers.PruneProvider({ url: node.endPoint, network: this.network })
          this.listProviders.push(provider)
          break
        case "none_prune":
          var provider = new providers.NonePruneProvider({ url: node.endPoint, network: this.network })
          this.listProviders.push(provider)
          break
      }
    }
  }

  subcribe() {
    console.log("subcribe")
    var callBackAsync = this.fetchData.bind(this)
    callBackAsync()
    this.intervalAsyncID = setInterval(callBackAsync, 10000)

    // var callBackSync = this.fetchDataSync.bind(this)
    // callBackSync()
    // this.intervalSyncID = setInterval(callBackSync, 3000)


    // var verifyExchange = this.verifyExchange
    // verifyExchange()
    // this.verifyExchangeId = setInterval(verifyExchange, 3000)

    // var callBack5Min = this.fetchData5Min.bind(this)
    // callBack5Min()
    // var interval5Min = setInterval(callBack5Min, 300000)
  }

  clearSubcription() {
    clearInterval(this.intervalID)
    clearInterval(this.intervalSyncID)
  }


  //var httpArr = BLOCKCHAIN_INFO.connections.http


  // var randomNum = Math.floor((Math.random() * httpArr.length))
  // this.httpUrl = httpArr[randomNum]
  // this.wsUrl = BLOCKCHAIN_INFO.connections.ws
  // this.httpProvider = this.getHttpProvider()
  // this.wsProvider = false

  //this.initProvider(props.default)

  // initProvider(provider) {
  //   switch (provider) {
  //     case "http":
  //       this.currentProvider = this.httpProvider
  //       this.currentLabel = "http"
  //       break
  //     case "ws":
  //       this.currentProvider = this.wsProvider
  //       this.currentLabel = "ws"
  //       break
  //     default:
  //       this.currentProvider = this.httpProvider
  //       this.currentLabel = "http"
  //       break
  //   }
  // }

  // getWebsocketProvider() {
  //   return new WebsocketEthereumProvider({
  //     url: this.wsUrl, failEvent: () => {
  //       var state = store.getState()
  //       var ethereum = state.connection.ethereum
  //       if (ethereum.wsProvider.connection) {
  //         ethereum.wsProvider.connection = false
  //         //ethereum.wsProvider.reconnectTime = 0
  //         store.dispatch(setConnection(ethereum))
  //       }
  //     }
  //   })
  // }

  // getHttpProvider() {
  //   return new HttpEthereumProvider({ url: this.httpUrl })
  // }

  // getProvider() {
  //   return this.currentProvider
  // }

  // setProvider(provider) {
  //   this.currentProvider = provider
  // }

  // subcribe() {
  //   //this.currentProvider.clearSubcription()
  //   //get gas price
  //   //this.fetchGasPrice()
  //   this.currentProvider.subcribeNewBlock(this.fetchData.bind(this))
  // }

  // clearSubcription() {
  //   this.currentProvider.clearSubcription()
  // }

  fetchData() {
    var state = store.getState()
    if (!common.checkComponentExist(state.global.params.appId)){
      this.clearSubcription()
      return
    }
    this.checkKyberEnable()

    //this.fetchTxsData()
    //this.fetchApproveTxsData()

    this.fetchRateData()
    //this.fetchRateUSD()

    this.fetchAccountData()
    //this.fetchTokenBalance()

    this.fetchRateExchange()

    //this.fetchHistoryExchange()

    this.checkConnection()


    this.fetchMaxGasPrice()
    this.fetchGasprice()
    

    this.fetchExchangeEnable()
    //this.verifyExchange()
    // this.verifyTransfer()

    // this.fetchGasExchange()
    // this.fetchGasTransfer()

    //this.fetMarketData()

  //  this.fetGeneralInfoTokens()

  // this.testAnalize()
  // this.testEstimateGas()
  }


  fetchData5Min(){
    this.fetchVolumn()
  }

  fetchDataSync() {
    var state = store.getState()
    this.verifyExchange()    
  }

  testAnalize() {
    var state = store.getState()
    var ethereum = state.connection.ethereum
   // store.dispatch(analyzeError(ethereum, "0x65f0b209035d3424c73f5cbcca20b57787940e756f6a193cd2464b5d02f0a1b7"))
  }

  // testEstimateGas() {
  //   this.call("estimateGasContract")
  // }
  
  fetchVolumn () {
    store.dispatch(marketActions.getVolumn())
  }
  
  fetchRateData() {
    var state = store.getState()
    var tokens = state.tokens.tokens
    var ethereum = state.connection.ethereum  
    store.dispatch(updateAllRate(ethereum, tokens))
  }

  fetchTokenBalance() {
    var state = store.getState()
    var ethereum = state.connection.ethereum
    var tokens = state.tokens.tokens
    var account = state.account.account
    if (account.address) {
      store.dispatch(updateTokenBalance(ethereum, account.address, tokens))
    }
  }

  fetchRateUSD() {
    var state = store.getState()
    var ethereum = state.connection.ethereum
    var tokens = state.tokens.tokens
    
    store.dispatch(updateAllRateUSD(ethereum, tokens))
  }

  fetchTxsData = () => {
    var state = store.getState()
    var tx
    var txs = state.txs
    var ethereum = state.connection.ethereum

    var account = state.account.account
    var listToken = {}
    Object.keys(txs).forEach((hash) => {
      tx = txs[hash]
      if (tx.status == "pending") {
        if (tx.type === "exchange") {
          var exchange = state.exchange
          listToken = {
            source: {
              symbol: exchange.sourceTokenSymbol,
              address: exchange.sourceToken
            },
            dest: {
              symbol: exchange.destTokenSymbol,
              address: exchange.destToken
            }
          }
          store.dispatch(updateTx(ethereum, tx, account, listToken))
        } else {
          var transfer = state.transfer
          listToken = {
            token: {
              symbol: transfer.tokenSymbol,
              address: transfer.token
            }
          }
          store.dispatch(updateTx(ethereum, tx, account, listToken))
        }

      }
    })
  }


  fetchApproveTxsData = () =>{
    store.dispatch(updateApproveTxsData())
  }

  fetchAccountData = () => {
    var state = store.getState()
    var ethereum = state.connection.ethereum
    var account = state.account.account
    if (account.address) {
      store.dispatch(updateAccount(ethereum, account))
    }
  }

  fetchCurrentBlock = () => {
    var state = store.getState()
    var ethereum = state.connection.ethereum
    store.dispatch(updateBlock(ethereum))
  }

  fetchRateExchange = (isManual = false) => {
    var state = store.getState()
    var exchange = state.exchange
    var tokens = state.tokens.tokens
    //var ethereum = state.connection.ethereum    
    var tokens = state.tokens.tokens
    

    if (exchange.sourceTokenSymbol === exchange.destTokenSymbol){
      return
    }

    var source = exchange.sourceToken
    var dest = exchange.destToken
    var sourceAmount

    if (exchange.isHaveDestAmount){
      //get rate source by eth
      var rateSource = Math.pow(10,18)     
      if (exchange.sourceTokenSymbol !== "ETH"){
        rateSource = tokens[exchange.sourceTokenSymbol].rate
      }
      var rateDest = Math.pow(10,18)     
      if (exchange.destTokenSymbol !== "ETH"){
        rateDest = tokens[exchange.destTokenSymbol].rateEth
      }
      var rate = rateSource * rateDest / Math.pow(10,18)      
      sourceAmount = converter.caculateSourceAmount(exchange.destAmount, rate.toString(), 6)

      //validate source amount too large
    }else{
      sourceAmount = exchange.sourceAmount
    }

    

    // if (parseFloat(sourceAmount) > 1000){
    //   store.dispatch(throwErrorHandleAmount())
    //   return 
    // }

    // var tokens = state.tokens.tokens
    // var sourceDecimal = 18
    var sourceTokenSymbol = exchange.sourceTokenSymbol
    // if (tokens[sourceTokenSymbol]) {
    //   sourceDecimal = tokens[sourceTokenSymbol].decimal
    // }

//    var sourceAmountHex = stringToHex(sourceAmount, sourceDecimal)

    // var destTokenSymbol = state.exchange.destTokenSymbol
    // var rateInit = 0
    // if (sourceTokenSymbol === 'ETH' && destTokenSymbol !== 'ETH') {
    //   rateInit = tokens[destTokenSymbol].minRateEth
    // }
    // if (sourceTokenSymbol !== 'ETH' && destTokenSymbol === 'ETH') {
    //   rateInit = tokens[sourceTokenSymbol].minRate
    // }

    store.dispatch(updateRateExchange(source, dest, sourceAmount, sourceTokenSymbol, isManual))
  }

  // fetchHistoryExchange = () => {
  //   var state = store.getState()
  //   var history = state.global.history
  //   var ethereum = state.connection.ethereum
  //   store.dispatch(updateBlock(ethereum))
  //   store.dispatch(updateHistoryExchange(ethereum, history.page, history.itemPerPage, true))
  // }

  fetchGasprice = () => {
    var state = store.getState()
    var ethereum = state.connection.ethereum
    store.dispatch(setGasPrice(ethereum))
  }

  fetchMaxGasPrice = () => {
    var state = store.getState()
    store.dispatch(setMaxGasPrice())
  }

  fetchGasExchange = () => {
    var state = store.getState()
    var account = state.account.account
    if (!account.address) {
      return
    }
    var pathname = state.router.location.pathname
    console.log(pathname)
    if (!pathname.includes(constants.BASE_HOST + "/swap")) {
      return
    }
    store.dispatch(estimateGas())
  }

  fetchGasTransfer = () => {
    var state = store.getState()
    var account = state.account.account
    if (!account.address) {
      return
    }

    var pathname = state.router.location.pathname
    if (!pathname.includes(constants.BASE_HOST + "/transfer")) {
      return
    }
    store.dispatch(estimateGasTransfer())
  }

  fetMarketData = () => {
    store.dispatch(marketActions.getMarketData())
  }

  fetGeneralInfoTokens() {
    store.dispatch(marketActions.getGeneralInfoTokens())
  }

  verifyExchange = () => {
    var state = store.getState()
    // var account = state.account.account
    // if (!account.address) {
    //   return
    // }
    
    var exchange = state.exchange
    if (exchange.step !== 1){
      return
    }
    // if (exchange.offeredRate == 0){
    //   return
    // }
    // var pathname = state.router.location.pathname
    // if (!pathname.includes(constants.BASE_HOST + "/swap")) {
    //   return
    // }
    store.dispatch(verifyExchange())
    //store.dispatch(caculateAmount())
  }

  verifyTransfer = () => {
    var state = store.getState()
    var account = state.account.account
    if (!account.address) {
      return
    }

    var pathname = state.router.location.pathname
    if (!pathname.includes(constants.BASE_HOST + "/transfer")) {
      return
    }
    store.dispatch(verifyTransfer())
  }

  checkConnection = () => {
    var state = store.getState()
    var checker = state.global.conn_checker
    var ethereum = state.connection.ethereum
    store.dispatch(checkConnection(ethereum, checker.count, checker.maxCount, checker.isCheck))
  }

  checkKyberEnable = () => {
    store.dispatch(checkKyberEnable())
  }

  fetchExchangeEnable = () => {
    var state = store.getState()
    var account = state.account.account
    if (!account.address) {
      return
    }

    var pathname = state.router.location.pathname
    if (!pathname.includes(constants.BASE_HOST + "/swap")) {
      return
    }
    store.dispatch(fetchExchangeEnable())
  }

  promiseOneNode(list, index, fn, callBackSuccess, callBackFail, ...args) {
    if (!list[index]) {
      callBackFail(new Error("Cannot resolve result: " + fn))
      return
    }
    if (!list[index][fn]) {
      console.log("Not have " + fn + " in " + list[index].rpcUrl)
      this.promiseOneNode(list, ++index, fn, callBackSuccess, callBackFail, ...args)
      return
    }
    list[index][fn](...args).then(result => {
      console.log("Resolve " + fn + "successful in " + list[index].rpcUrl)
      callBackSuccess(result)
    }).catch(err => {
      console.log(err.message + " -In provider: " + list[index].rpcUrl)
      this.promiseOneNode(list, ++index, fn, callBackSuccess, callBackFail, ...args)
    })
  }

  call(fn, ...args) {
    return new Promise((resolve, reject) => {
      this.promiseOneNode(this.listProviders, 0, fn, resolve, reject, ...args)
    })
  }


  promiseMultiNode(list, index, fn, callBackSuccess, callBackFail, results, errors, ...args) {
    if (!list[index]) {
      if(results.length > 0){
       // callBackSuccess(results[0])
       console.log("resolve "+fn+" successfully in some nodes")
      }else{
        callBackFail(errors)
      }      
      return
    }
    if (!list[index][fn]) {
      console.log(list[index].rpcUrl +  " not support func: " + fn)
      errors.push(new Error(list[index].rpcUrl +  " not support func: " + fn))
      this.promiseMultiNode(list, ++index, fn, callBackSuccess, callBackFail, results, errors, ...args)
      return
    }
    list[index][fn](...args).then(result => {      
      console.log("Call " + fn + " successfully in " + list[index].rpcUrl)
      results.push(result)
      this.promiseMultiNode(list, ++index, fn, callBackSuccess, callBackFail, results, errors, ...args)
      callBackSuccess(result)
    }).catch(err => {
      console.log(err.message + " -In provider: " + list[index].rpcUrl)
      errors.push(err)
      this.promiseMultiNode(list, ++index, fn, callBackSuccess, callBackFail, results, errors, ...args)
    })
  }

  callMultiNode(fn, ...args) {
    var errors = []
    var results = []
    return new Promise((resolve, reject) => {
      this.promiseMultiNode(this.listProviders, 0, fn, resolve, reject, results, errors, ...args)
    })
  }

}