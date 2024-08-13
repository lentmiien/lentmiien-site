const cache = {};

function SelectRepository(e) {
  // User select a repository from a select box
  // Create or load cache entry
  //  - Create: Send GET request to '/mypage/getrepository' -> return file structure of top folder
  // Display folder structure currently saved in cache
}

function LoadFolder(path) {
  // User clicks on a folder in the displayed folder structure
  // If folder content hasn't been loaded then load and save to cache
  //  - Load: Send GET request to '/mypage/getfolder' -> return file structure of folder
  // Display updated folder structure currently saved in cache
}

function LoadFile(path) {
  // User clicks on a file in the displayed folder structure
  // If file content hasn't been loaded then load and save to cache
  //  - Load: Send GET request to '/mypage/getfile' -> return file data
  // Display file data
}