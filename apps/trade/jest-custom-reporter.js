const { default: axios } = require("axios");

class CustomReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options;
    this.slackWebhookUrl = "https://hooks.slack.com/services/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";
    this.env = process.env.VITE_BUILD_TYPE
  }
  getUniqueFullNamesWithStatus(data) {
    const uniqueFullNames = {};

    // Iterate over the data to collect unique full names with statuses
    data.forEach((item) => {
      const { fullName, status } = item;
      // Check if the full name already exists
      if (uniqueFullNames.hasOwnProperty(fullName)) {
        // If it exists, add the status to the existing array
        uniqueFullNames[fullName].push(status);
      } else {
        // If it doesn't exist, create a new array with the status
        uniqueFullNames[fullName] = [status];
      }
    });

    // Format the data into a string
    let formattedString = "";
    for (const fullName in uniqueFullNames) {
      formattedString += `${uniqueFullNames[fullName].join(",") === "passed" && ":white_check_mark:"}  ${fullName} \n \n \n`;
    }

    return formattedString;
  }

  onRunComplete(test, results) {
    // if (this.env === "staging" || this.env === "production") {

      const message = `
      *Test Results*
      Total: ${results.numTotalTests} :white_check_mark:
      Passed: ${results.numPassedTests} :white_check_mark:
      Failed: ${results.numFailedTests}  :x:

    `;
      const report2 = this.getUniqueFullNamesWithStatus(results.testResults.flatMap((item) => item.testResults.map(({ fullName, status, title }) => ({ fullName, status, title }))));
      axios
        .post(this.slackWebhookUrl, {
          text: ` ${report2}  ${message}`
        })
        .catch((err) => console.log(err));
    // }
  }
}

module.exports = CustomReporter;
