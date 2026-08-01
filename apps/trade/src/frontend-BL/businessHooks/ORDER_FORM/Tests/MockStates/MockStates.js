export const MockState_1 = {
  futures: {
    accountInfo: {
      totalCrossWalletBalance: 5000
    },
    openOrders: []
  },
  positionsDirectory: {
    crossWalletDetails: [
      {
        sym: "BTCUSDT",
        side: "LONG",
        posAmt: 0.5,
        initialMargin: 1000
      },
      {
        sym: "ETHUSDT",
        side: "SHORT",
        posAmt: -1,
        initialMargin: 500
      }
    ],
    unRealizedPnLForCross: [
      {
        sym: "BTCUSDT",
        unRealisedPnl: 200
      },
      {
        sym: "ETHUSDT",
        unRealisedPnl: -100
      }
    ],
    leverage: [
      {
        sym: "BTCUSDT",
        leverage: 10
      },
      {
        sym: "ETHUSDT",
        leverage: 5
      }
    ]
  },
  OpenOrdersStream: {
    OpenOrdersStream: []
  },
  selectSymbol: { selectedSymbol: "BTCUSDT" }
};
