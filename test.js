require('dotenv').config();
const fs = require('fs');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function Test() {
  // Generate an audio response to the given prompt
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini-audio-preview",
    modalities: ["text", "audio"],
    audio: { voice: "sage", format: "wav" },
    messages: [
      {
        role: "user",
        content: "Is a golden retriever a good family dog?"
      }
    ]
  });

  // Inspect returned data
  console.log(response.choices[0]);
// {
//   index: 0,
//   message: {
//     role: 'assistant',
//     content: null,
//     refusal: null,
//     audio: {
//       id: 'audio_67825f12fea881908db68fab05060aa3',
//       data: '...BASE64_DATA...',
//       expires_at: 1736600866,
//       transcript: 'Yes, a Golden Retriever is often considered a great family dog. They are known for their friendly and gentle temperament, which makes them good with children and other pets. Golden Retrievers are also intelligent and easy to train, which can be advantageous for families looking for a loyal and affectionate companion.'
//     }
//   },
//   finish_reason: 'stop'
// }

  // Write audio data to a file
  fs.writeFileSync(
    "dog.wav",
    Buffer.from(response.choices[0].message.audio.data, 'base64'),
    { encoding: "utf-8" }
  );
}
Test();

// const ExcelJS = require('exceljs');
// const fs = require('fs');
// const filePath = "C:\\Users\\lentm\\Documents\\Ringfit.xlsx";
// async function Load() {
//   try {
//     const workbook = new ExcelJS.Workbook();
//     await workbook.xlsx.readFile(filePath);
//     const worksheet = workbook.worksheets[0];
//     // Extract data
//     const data = [];
//     worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
//         data.push(row.values);
//     });
//     console.log(data);
//   } catch {
//     console.log("ERROR");
//   }
// }
// Load();
