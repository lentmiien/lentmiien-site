const { LogModel, SummaryModel } = require('../database');
const { whisper } = require('../utils/ChatGPT');

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
exports.voice_recorder = (req, res) => {
  res.render('voice_recorder');
};
exports.voice_recorder_upload = async (req, res) => {
  // const text = await whisper(`./${req.file.path}`);
  const text = "TEST";
  console.log(text);
  res.send(text);
};
