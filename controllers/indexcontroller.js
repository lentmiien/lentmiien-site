const { LogModel, SummaryModel, AggregatedDataModel, DetailedDataModel, Dht22AggregatedData, Dht22DetailedData } = require('../database');

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
exports.scroll_test = (req, res) => {
  res.render('scroll_test')
};

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.electricity_usage = async (req, res) => {
  const log = await LogModel.find();
  const summary = await SummaryModel.find();
  res.render('electricity_usage', {log, summary});
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.mpu6050 = async (req, res) => {
  const aggregated_data = await AggregatedDataModel.find();
  const detailed_data = await DetailedDataModel.find();
  res.render('mpu6050', {aggregated_data, detailed_data});
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.dht22 = async (req, res) => {
  const aggregated_data = await Dht22AggregatedData.find();
  const detailed_data = await Dht22DetailedData.find();
  res.render('dht22', {aggregated_data, detailed_data});
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.test_editor = (req, res) => {
  res.render("test_editor");
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.api_test = (req, res) => {
  res.json({
    message: "Hello and welcome to Lennart's website!",
    url: "https://my.lentmiien.com/"
  });
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.img_select = (req, res) => {
  res.render("img_select");
}
