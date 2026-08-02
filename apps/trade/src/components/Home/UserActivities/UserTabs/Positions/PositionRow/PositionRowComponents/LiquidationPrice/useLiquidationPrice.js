import { UPDATE_LIQUIDATION_PRICE } from "@/frontend-BL/redux/constants/Constants";
import { SymbolPrecisionHelper } from "@/helpers";
import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";

export const useLiquidationPrice = ({ symbol }) => {
  const symbolMarkPrice = useSelector((state) => state.BinanceStreamData.binanceData?.[`${symbol?.toLowerCase()}@markPrice@1s`]);
  const currentPositionData = useSelector((state) => state.positionsDirectory.currentPositions?.find((data) => data.sym === symbol));
  const getPositionSize = Number(currentPositionData?.posAmt) * Number(symbolMarkPrice);
  const leverageBracketData = useSelector((state) => state.leverageBracket.leverageBracket.find((sym) => sym.symbol === symbol));
  const getPositionAmount = currentPositionData?.posAmt;
  const getEntryPrice = currentPositionData?.entryPrice;
  const getIsolatedWallet = useSelector((state) => state.positionsDirectory.isolatedWallet.find((data) => data.sym === symbol));
  const activeCrossedPositions = useSelector((state) => state.positionsDirectory.crossWalletDetails);
  const calculatedCrossedPositionForCurrentContract = activeCrossedPositions.find((position) => position.symbol.toLowerCase() === symbol.toLowerCase());
  const calculatedCrossedPositionForOtherContracts = useMemo(() => {
    return activeCrossedPositions.filter((position) => position.symbol.toLowerCase() !== symbol.toLowerCase());
  }, [activeCrossedPositions]);
  const crossWalletBalance = useSelector((state) => state.futures.accountInfo.totalCrossWalletBalance);
  const activeCrossedPositionsPnLData = useSelector((state) => state.positionsDirectory.unRealizedPnLForCross);
  // PERPIFY: live margin params from the engine (SESSION_INFO). Density's leverageBracket
  // is empty on testnet, so we compute the isolated liq price from these instead.
  const sessionInfo = useSelector((state) => state.sessionInfo);
  const { setDecimalPrecision, symbolPricePrecision } = SymbolPrecisionHelper({
    symbol
  });
  const dispatch = useDispatch();
  const MarginRatioHelpers = useMemo(() => {
    const size = Math.abs(getPositionSize);
    if (leverageBracketData !== undefined) {
      const leverageData = leverageBracketData.brackets;
      if (leverageData !== undefined) {
        for (let i = 0; i < leverageData.length; i++) {
          if (size >= leverageData[i].notionalFloor && size <= leverageData[i].notionalCap) {
            return {
              maintainanceMargin: size * leverageData[i].maintMarginRatio - leverageData[i].cum,
              mmr: leverageData[i].maintMarginRatio,
              cum: leverageData[i].cum
            };
          }
        }
      }
    }
  }, [leverageBracketData, getPositionSize]);

  const liquidationPrice = useMemo(() => {
    // PERPIFY: isolated liq price from the engine's live margin params (SESSION_INFO):
    //   mmF = max(baseMm × gapCoeff × tierMult, mmFloor);  P = (e·q·dir − iso) / (q·(dir − mmF))
    const e = Number(getEntryPrice);
    const q = Math.abs(Number(getPositionAmount));
    const iso = Number(getIsolatedWallet?.isolatedWallet);
    if (sessionInfo && typeof sessionInfo.baseMmBps === "number" && q > 0 && e > 0 && Number.isFinite(iso)) {
      const dir = currentPositionData?.side === "BUY" || Number(getPositionAmount) > 0 ? 1 : -1;
      const gap = Number(sessionInfo.gapCoefficient) || 1;
      const tierMult = Number(sessionInfo.tierMult) || 1;
      const mmF = Math.max((sessionInfo.baseMmBps / 10000) * gap * tierMult, (Number(sessionInfo.mmFloorBps) || 0) / 10000);
      const denom = q * (dir - mmF);
      if (denom !== 0) {
        const liqPx = (e * q * dir - iso) / denom;
        dispatch({
          type: UPDATE_LIQUIDATION_PRICE,
          payload: { sym: symbol, liquidationPrice: setDecimalPrecision(String(Math.max(0, liqPx)), symbolPricePrecision) }
        });
        return liqPx <= 0 ? "--" : setDecimalPrecision(String(liqPx), symbolPricePrecision);
      }
    }
    if (
      currentPositionData?.marginType?.toUpperCase() === "ISOLATED" &&
      MarginRatioHelpers?.mmr !== 0 &&
      getIsolatedWallet !== undefined &&
      getPositionAmount !== undefined &&
      getEntryPrice !== undefined &&
      MarginRatioHelpers?.cum !== null
    ) {
      const numerator = Number(getIsolatedWallet.isolatedWallet) + MarginRatioHelpers?.cum - getPositionAmount * getEntryPrice;
      const denominator = Math.abs(getPositionAmount) * MarginRatioHelpers?.mmr - getPositionAmount;
      const liqPrice = numerator / denominator;
      dispatch({
        type: UPDATE_LIQUIDATION_PRICE,
        payload: {
          sym: symbol,
          liquidationPrice: setDecimalPrecision(String(liqPrice), symbolPricePrecision)
        }
      });
      return liqPrice < 0 ? "--" : setDecimalPrecision(String(liqPrice), symbolPricePrecision);
    } else if (
      currentPositionData?.marginType?.toUpperCase() !== "ISOLATED" &&
      MarginRatioHelpers?.mmr !== 0 &&
      getIsolatedWallet !== undefined &&
      getPositionAmount !== undefined &&
      getEntryPrice !== undefined &&
      MarginRatioHelpers?.cum !== null
    ) {
      let totalMaintenanceMarginForOtherContracts = 0;
      let totalUnrealizedPnlForOtherContracts = 0;
      let liquidationPrice = "--";
      if (calculatedCrossedPositionForOtherContracts && calculatedCrossedPositionForOtherContracts.length) {
        totalMaintenanceMarginForOtherContracts = calculatedCrossedPositionForOtherContracts.reduce((accumulator, position) => (Number(position.maintMargin) || 0) + accumulator, 0);
        totalUnrealizedPnlForOtherContracts = activeCrossedPositionsPnLData.reduce((accumulator, position) => (Number(position.unRealisedPnl) || 0) + accumulator, 0);
      }
      if (calculatedCrossedPositionForCurrentContract && Object.keys(calculatedCrossedPositionForCurrentContract).length) {
        liquidationPrice =
          (Number(crossWalletBalance) -
            Number(totalMaintenanceMarginForOtherContracts) +
            Number(totalUnrealizedPnlForOtherContracts) +
            calculatedCrossedPositionForCurrentContract.cum -
            (currentPositionData?.side === "BUY" ? 1 : -1) * Math.abs(Number(getPositionAmount)) * Number(getEntryPrice)) /
          (Math.abs(Number(getPositionAmount)) * (calculatedCrossedPositionForCurrentContract.mmr - (currentPositionData?.side === "BUY" ? 1 : -1)));
      }
      dispatch({
        type: UPDATE_LIQUIDATION_PRICE,
        payload: { sym: symbol, liquidationPrice }
      });
      const liqPrice = liquidationPrice > 0 ? fallbackForNaN(liquidationPrice) : "--";
      return liqPrice;
    }
  }, [MarginRatioHelpers, activeCrossedPositionsPnLData, getPositionAmount, symbol, currentPositionData, sessionInfo, getIsolatedWallet]);

  function fallbackForNaN(number) {
    if (isNaN(number)) {
      return "--";
    }
    return setDecimalPrecision(String(number), symbolPricePrecision);
  }

  return {
    liquidationPrice,

    MarginRatioHelpers,
    setDecimalPrecision
  };
};
