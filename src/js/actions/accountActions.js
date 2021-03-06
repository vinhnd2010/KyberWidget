
export function updateAccount(ethereum, account) {
  return {
    type: "ACCOUNT.UPDATE_ACCOUNT_PENDING",
    payload: { ethereum, account }
  }
}

export function updateTokenBalance(ethereum, address, tokens){
  return {
    type: "ACCOUNT.UPDATE_TOKEN_BALANCE",
    payload: { ethereum, address, tokens }
  }
}

export function updateAccountComplete(account) {
  return {
    type: "ACCOUNT.UPDATE_ACCOUNT_FULFILLED",
    payload: account
  }
}

export function importLoading() {
  return {
    type: "ACCOUNT.LOADING"
  }
}

export function checkTimeImportLedger() {
  return {
    type: "ACCOUNT.CHECK_TIME_IMPORT_LEDGER"
  }
}

export function resetCheckTimeImportLedger() {
  return {
    type: "ACCOUNT.RESET_CHECK_TIME_IMPORT_LEDGER"
  }
}

export function pKeyChange(value) {
  return {
    type: "ACCOUNT.PKEY_CHANGE",
    payload: value
  }
}

export function openImportAccount(type) {
  return {
    type: "ACCOUNT.OPEN_IMPORT_ACCOUNT",
    payload: type
  }
}

export function closeImportAccount() {
  return {
    type: "ACCOUNT.CLOSE_IMPORT_ACCOUNT",
  }
}

export function throwPKeyError(error) {
  return {
    type: "ACCOUNT.PKEY_ERROR",
    payload: error
  }
}

export function importNewAccount(address, type, keystring, metamask = null) {
  return {
    type: "ACCOUNT.IMPORT_NEW_ACCOUNT_PENDING",
    payload: { address, type, keystring, metamask }
  }
}

export function importNewAccountComplete(account) {
  return {
    type: "ACCOUNT.IMPORT_NEW_ACCOUNT_FULFILLED",
    payload: account
  }
}

export function closeImportLoading() {
  return {
    type: "ACCOUNT.CLOSE_LOADING_IMPORT"
  }
}

export function throwError(error) {
  return {
    type: "ACCOUNT.THROW_ERROR",
    payload: error
  }
}

export function closeErrorModal() {
  return {
    type: "ACCOUNT.CLOSE_ERROR_MODAL"
  }
}

export function incManualNonceAccount(address) {
  return {
    type: "ACCOUNT.INC_MANUAL_NONCE_ACCOUNT",
    payload: address
  }
}

export function importAccountMetamask(web3Service, networkId) {
  return {
    type: "ACCOUNT.IMPORT_ACCOUNT_METAMASK",
    payload: { web3Service, networkId }
  }
}

export function setWallet(wallet) {
  return {
    type: "ACCOUNT.SET_WALLET",
    payload: wallet
  }
}

export function clearWatchMetamask(){
  return {
    type: "ACCOUNT.CLEAR_WATCH_METAMASK"
  }
}
