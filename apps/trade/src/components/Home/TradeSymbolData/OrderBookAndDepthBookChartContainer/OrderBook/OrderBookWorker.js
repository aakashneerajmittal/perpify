const workerCode = ` 

self.onmessage = function (event) {
  self.onmessage = function (event) {

    const { type, payload } = event.data;

    switch (type) {
      case 'ORDER_BOOK':
      const updatedAsksStream = addTotalSums(findAndDelete(payload.currentLevel.asks,payload.latestOrder.asks,"ASKS"));
      const updatedBidsStream = addTotalSums(findAndDelete(payload.currentLevel.bids,payload.latestOrder.bids,"BIDS"));
      const updatedBidsStreamOrderBook =  addTotalSums(findAndDelete(payload.currentLevel.bids,payload.latestOrder.bids,"BIDS"));
      const updatedAsksStreamOrderBook =addTotalSums(findAndDelete(payload.currentLevel.asks,payload.latestOrder.asks,"ASKS"));

      self.postMessage({ type: 'DEPTH_BOOK', message: {updatedAsksStream ,updatedBidsStream} });
      self.postMessage({ type: 'ORDER_BOOK', message: {updatedAsksStreamOrderBook ,updatedBidsStreamOrderBook} });
        break;
    }
  };

 
}
function findAndDelete (currentLevels,orders,type) {
  // Guard the empty/undefined cases: the order book column now mounts on every load (not just
  // when its tab is opened), so this worker runs before the first book snapshot arrives — and
  // also in the brief window before data on the live site. Without these guards, an empty
  // 'orders' (orders[orders.length-1] is undefined) or a missing currentLevels threw and the
  // book failed to initialise.
  if(!orders || orders.length === 0){
    return currentLevels || [];
  }
  if(currentLevels && currentLevels.length){
    const index = type === "BIDS" ? currentLevels.findIndex((item) => Number(item[0]) <= Number(orders[orders.length - 1][0])) : currentLevels.findIndex((item) => Number(item[0]) >= Number(orders[orders.length - 1][0]))
    return orders.concat(currentLevels.slice(index + 1))
  }
  return orders;
}
function addTotalSums(orders){
  let sum = 0;
  return (orders || []).map((item) => {
      sum += Number(item[1]);
      item[2] = sum
      return item;
  });
}

 const roundToNearest = (value, interval) => {
  return Math.floor(Number(value) / interval) * interval;
};
 const groupByPrice = (levels) => {
  return levels.map((level, idx) => {
    const nextLevel = levels[idx + 1];
    const prevLevel = levels[idx - 1];

    if(nextLevel && Number(level[0]) === Number(nextLevel[0])) {
      return [Number(level[0]), Number(level[1]) + Number(nextLevel[1])]
    } else if(prevLevel && Number(level[0]) === Number(prevLevel[0])) {
      return [];
    } else {
      return level;
    }
  }).filter(level => level.length > 0);
};
 const groupByTicketSize = (levels, ticketSize)=> {
  return groupByPrice(levels.map(level => [roundToNearest(level[0], ticketSize), level[1]]));
};

function sumMatchingElements(arr) {
  const sums = {};

  arr.forEach(([num, val]) => {
    if (sums[Number(num)]) {
      sums[num] += Number(val);
    } else {
      sums[num] = Number(val);
    }
  });

  return Object.entries(sums).map(([num, val]) => [parseInt(num), val])
}

`;
const blob = new Blob([workerCode], { type: "application/javascript" });
const workerUrl = URL.createObjectURL(blob);
const worker = new Worker(workerUrl);
export default worker;
