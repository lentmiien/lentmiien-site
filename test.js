const ExcelJS = require('exceljs');
const fs = require('fs');

const filePath = "C:\\Users\\lentm\\Documents\\Ringfit.xlsx";

async function Load() {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];

    // Extract data
    const data = [];
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        data.push(row.values);
    });

    console.log(data);
  } catch {
    console.log("ERROR");
  }
}
Load();
