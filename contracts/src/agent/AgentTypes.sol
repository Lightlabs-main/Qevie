// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

enum AgentActionType {
    SINGLE_PAYMENT,
    BATCH_PAYMENT,
    PAYMENT_REQUEST,
    SUBSCRIPTION
}

enum AgentGasMode {
    SPONSORED_ONBOARDING,
    QUSDC_GAS,
    NATIVE_QIE,
    PAUSED
}

struct AgentPolicy {
    address smartAccount;
    address owner;
    address sessionKey;
    address guardian;
    address token;
    uint256 maxPerTx;
    uint256 dailyLimit;
    uint256 weeklyLimit;
    uint256 totalLimit;
    uint256 spentToday;
    uint256 spentThisWeek;
    uint256 spentTotal;
    uint256 maxQusdcGasPerTx;
    uint256 dailyQusdcGasCap;
    uint256 spentQusdcGasToday;
    uint64 dayWindowStart;
    uint64 weekWindowStart;
    uint64 gasDayWindowStart;
    uint64 validAfter;
    uint64 validUntil;
    bool allowSinglePayment;
    bool allowBatchPayment;
    bool allowPaymentRequest;
    bool allowSubscription;
    bool allowSponsoredGas;
    bool allowQusdcGas;
    bool allowNativeQieFallback;
    bool pauseWhenGasUnavailable;
    bool active;
    bool guardianRevoked;
}

