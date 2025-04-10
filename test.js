const lmstudio = require("./utils/lmstudio");

async function test() {
  const response = await lmstudio.chat("Please tell me a couple of different jokes.");
  console.log(response);
}

test();