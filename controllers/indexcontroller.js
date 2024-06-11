exports.index = (req, res) => {
  res.render('index');
};

exports.login = (req, res) => {
  res.render('login');
};

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
const archiver = require('archiver');
exports.download_test = async (req, res) => {
  try {
    // Create a ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Set the compression level
    });

    // Set the response headers
    res.attachment(`files_${Date.now()}.zip`);

    // Pipe the archive to the response
    archive.pipe(res);

    // Append string to file
    archive.append((new Date()).toString(), { name: 'current_date_time.txt' });

    // Append files to the archive
    archive.directory("./public/js", false);

    // Finalize the archive
    await archive.finalize();
  } catch (err) {
    console.error('Error occurred:', err);
    res.sendStatus(500);
  }
};

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
const path = require('path');
const fs = require('fs');
const { Poppler } = require('node-poppler');
exports.poppler_test = async (req, res) => {
  try {
    const outputDir = "C:\\Users\\lentm\\Documents\\Programming\\lentmiien-site\\public\\temp";
    const outputFile = `C:\\Users\\lentm\\Documents\\Programming\\lentmiien-site\\public\\temp\\test_document`;

    const poppler = new Poppler();

    // Convert PDF to JPEG
    const options = {
      jpegFile: true,
      singleFile: false,
      firstPageToConvert: 1,
      lastPageToConvert: 9999,
    };

    await poppler.pdfToCairo("C:/Users/lentm/Downloads/gst-e-tax-guide_taxing-imported-low-value-goods-by-way-of-the-overseas-vendor-registration-regime_(1st-ed).pdf", outputFile, options);

    // List all converted images
    const images = fs.readdirSync(outputDir);

    // Convert images to URLs
    const imageUrls = images.map((image) => `/temp/${image}`);

    res.send(`
      <!DOCTYPE html>
      <html>
      <body>
        ${imageUrls.map((url) => `<img src="${url}" /><br>`).join('')}
      </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error processing PDF.');
  }
};