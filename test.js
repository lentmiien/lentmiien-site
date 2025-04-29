require('dotenv').config();
const fs = require('fs');
const { mod } = require('./utils/ChatGPT');

async function test() {
  const image_data = loadImageToBase64("F711C993-E6FE-4E76-B13C-AEAA99C98D20.jpg");
  const resp = await mod(image_data);
  const num = Date.now();
  fs.writeFileSync(`./tmp_data/mod_out_${num}.json`, JSON.stringify(resp, null ,2));
  console.log(`Output saved to "./tmp_data/mod_out_${num}.json"`);
}

function loadImageToBase64(filename) {
  const img_buffer = fs.readFileSync(`C:/Users/lentm/Documents/Programming/lentmiien-site/tmp_data/${filename}`);
  const b64_img = Buffer.from(img_buffer).toString('base64');
  return b64_img;
}

test();