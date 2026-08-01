// import React from "react";
// import { render } from "@testing-library/react";
// import YourComponentUsingTheHook from "./YourComponentUsingTheHook"; // Import your component

// // Mock useSelector to provide the necessary state data
// jest.mock("react-redux", () => ({
//   useSelector: jest.fn()
// }));

// describe("Integration Test: YourComponentUsingTheHook with useMarketBestPricehandler", () => {
//   it("renders correctly for BUY side", () => {
//     // Define the mock state data for the BUY side
//     const mockState = {
//       OrderBook: { OrderBook: { a: [{ P: 100 }] } },
//       selectSymbol: { selectedSymbol: "BTCUSDT" },
//       BinanceStreamData: { ticker: [{ symbol: "BTCUSDT", ltp: 10000 }] }
//     };

//     // Mock useSelector to return the appropriate state data
//     jest
//       .spyOn(require("react-redux"), "useSelector")
//       .mockImplementation((selector) => selector(mockState));

//     // Render your component that uses the hook
//     const { getByText } = render(<YourComponentUsingTheHook side="BUY" />);

//     // Assuming your component renders something based on the hook's result
//     const assumingPriceText = getByText("Assuming Price:");

//     // Assert that the rendered component contains the expected text or elements
//     expect(assumingPriceText).toBeInTheDocument();
//     // You can add more assertions as needed based on your component's behavior
//   });

//   it("renders correctly for SELL side", () => {
//     // Define the mock state data for the SELL side
//     const mockState = {
//       OrderBook: { OrderBook: { b: [{ P: 100 }] } },
//       selectSymbol: { selectedSymbol: "BTCUSDT" },
//       BinanceStreamData: { ticker: [{ symbol: "BTCUSDT", ltp: 10000 }] }
//     };

//     // Mock useSelector to return the appropriate state data
//     jest
//       .spyOn(require("react-redux"), "useSelector")
//       .mockImplementation((selector) => selector(mockState));

//     // Render your component that uses the hook
//     const { getByText } = render(<YourComponentUsingTheHook side="SELL" />);

//     // Assuming your component renders something based on the hook's result
//     const assumingPriceText = getByText("Assuming Price:");

//     // Assert that the rendered component contains the expected text or elements
//     expect(assumingPriceText).toBeInTheDocument();
//     // You can add more assertions as needed based on your component's behavior
//   });
// });
