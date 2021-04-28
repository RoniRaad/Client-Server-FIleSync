const WebSocket = require('ws')
var fs = require('fs');
const wss = new WebSocket.Server({ port: 8080 })

const Path = require('path')
const { resolve } = require('path');
const { readdir } = require('fs').promises;

console.log("Server Started...")

/**
 * Runs on websocket connection. Validates password, then handles incoming messages
 */
wss.on('connection', ws => {
    var loggedIn
    console.log("Client Connected...")
    ws.on('message', message => {

            var payloadArgs = JSON.parse(message);
            if (payloadArgs["type"] == "loginServer"){
                if ( loggedIn || payloadArgs["secret"] == "{Super Secret Password}"){
                    loggedIn = true;
                    ws.send(JSON.stringify({
                        type:"loggedIn", 
                    }))
                }
                else
                    loggedIn = false;

            }
            // List of files recieved, a check is then performed to see if the client or server has a more recent copy.
            else if (payloadArgs["type"] == "checkMTime"){
                payloadArgs = JSON.parse(message.toString().replace(/\\/g, '/').replace(/\/\//g,'/'));
                var filesMTimeStatus = {};
                var remoteFiles = payloadArgs["files"];
                var filesLeft = Object.assign({}, remoteFiles);

                if (!fs.existsSync("./" + payloadArgs["syncName"]))
                    fs.mkdirSync("./" + payloadArgs["syncName"]);
                
                // Iterates over local files and compares them to remote files
                getFiles("./" + payloadArgs["syncName"]).then((files)=>{
                    var sameFile = 0;

                    if (files.length == 0)
                        Object.keys(remoteFiles).forEach((requestFile) => clientRequestFile(ws, requestFile, payloadArgs["syncName"]))
                    
                    files.forEach(function (file) {
                        var curFile = file.replace(__dirname + '/', "").replace(/\\/g, '/')
                        delete filesLeft[curFile];

                        fs.stat(file, function (err, stats) {
                            // filesMTimeStatus is an array in which the key is the filePath and the value is either true or the mtime of the file dependant on whether the client has a newer file
                            if (!remoteFiles[curFile]){
                                // If the client doesn't have the file on their system, send them a copy to write
                                fs.readFile(curFile.replace(/\\/g, '/'), (err, fileContents) =>{
                                    if (!err)
                                        clientUpdateFile(ws, fileContents.toString('base64'), curFile, stats.mtime.getTime(), payloadArgs["syncName"])
                                    else
                                        console.log("Error reading file: " + err)
                                })
                                sameFile++;
                            }
                            else{
                                // If the client has a newer file request the file from them
                                if (remoteFiles[curFile] > stats.mtime.getTime()){ // Case, remote client has newer files
                                    filesMTimeStatus[curFile] = true;
                                }
                                // If the client has a older file, send them the update version and request they overwrite it
                                else if (remoteFiles[curFile] < stats.mtime.getTime()){ // Case, local server has newer files
                                    filesMTimeStatus[curFile] = stats.mtime.getTime(); 
                                }
                                // If the client has the same file as the local file, skip it
                                else
                                    sameFile++;
                                
                            }
                            // Use the data obtained above to decide what to do with each file.
                            filesMTimeKeys = Object.keys(filesMTimeStatus);

                            // Validate the size of the array
                            if (filesMTimeKeys.length + sameFile == files.length){

                                // Iterate over all the files
                                filesMTimeKeys.forEach((requestFile) =>{
                                    // Keep the requestPath in local scope to prevent race condition
                                    var requestPath = requestFile;

                                    // If the client has a newer file request the file from them
                                    if (filesMTimeStatus[requestPath] == true){
                                        clientRequestFile(ws, requestPath, payloadArgs["syncName"])
                                    }
                                    // If the client has a older file, send them the update version and request they overwrite it
                                    else{
                                        fs.readFile(requestPath.replace(/\\/g, '/'), (err, fileContents) =>{
                                            clientUpdateFile(ws, fileContents.toString('base64'), requestPath, filesMTimeStatus[requestPath], payloadArgs["syncName"])
                                        })
                                    }
                                })
                                // Request any files that did not exist on our local system.
                                if (Object.keys(filesLeft).length > 0){
                                    Object.keys(filesLeft).forEach((fileName) => clientRequestFile(ws, fileName, payloadArgs["syncName"]))
                                }
                            }                   
                        })
                    })
                })
            }
            else if (payloadArgs["type"] == "updateFile")
                updateFile(payloadArgs["filePath"],  payloadArgs["contents"], payloadArgs["uTime"])

  })
})

/** Writes to the given file the given fileContents, then sets the modified time of the file to the given mTime (seconds past unix epoch)
 * 
 * @param {string} filePath Path file will be written to.
 * @param {string (base64)} fileContents string to write to file
 * @param {string} mTime Last modified time in seconds past unix epoch
 */
function updateFile(filePath, fileContents, mTime){
    filePath = filePath.replace(/\\/g, '/');
    fs.exists(Path.win32.dirname(filePath), (exists) =>{
        if (!exists)
          fs.mkdir(Path.win32.dirname(filePath), { recursive: true }, function (err) {
              console.log(err)
            fs.writeFile(filePath, fileContents, {encoding:'base64'}, (err) =>{
              if (!err){
                  console.log(filePath + " written!")
                  fs.utimes(filePath, new Date(mTime), new Date(mTime), (err)=>{
                      if (!err)
                      console.log(filePath + " had mTime set!")
                  else
                      console.log(err)
                  });
                }
                else
                  console.log(err)
            });
          });
        else
          fs.writeFile(filePath, fileContents, {encoding:'base64'}, (err) =>{
            if (!err){
              console.log(filePath + " written!")
              fs.utimes(filePath, new Date(mTime), new Date(mTime), (err)=>{
                  if (!err)
                      console.log(filePath + " had mTime set!")
                  else
                      console.log(err)
              });
            }
            else
              console.log(err)
          });
      }) 
}

/** Requests the client to send the server and updated file
 * 
 * @param {string} socket The socket to the client.
 * @param {*} filePath  The file path to write the file to.
 * @param {*} syncName  The syncName of the current file.
 */
function clientRequestFile(socket, filePath, syncName){
    socket.send(JSON.stringify({
        type:"requestFile", 
        file:filePath,
        syncName:syncName
    }))
}

/** Send the client an updated file for them to write
 * 
 * @param {string} socket The socket to the client.
 * @param {string} fileContents The contents of the file for client to update.
 * @param {string} filePath The path of the file on the clients computer.
 * @param {string} mTime The last modified time of the file to be set on the client, Seconds from unix epoch.
 * @param {string} syncName The syncName of the current file.
 */
function clientUpdateFile(socket, fileContents, filePath, mTime, syncName){
    socket.send(JSON.stringify({
        type: "updateFile", 
        contents: fileContents,
        filePath: filePath,
        syncName: syncName,
        uTime: mTime,
    }))
}

/** Returns an array of files in the directory recursively
 *  This function was taken from stackoverflow
 * 
 * @param {string} dir Directory to look for files
 */
async function getFiles(dir) {
    const dirents = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
      const res = resolve(dir, dirent.name);
      return dirent.isDirectory() ? getFiles(res) : res;
    }));
    return Array.prototype.concat(...files);
  }
  
