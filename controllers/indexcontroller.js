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
