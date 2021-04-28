/**
 * This is the client-side node.js application used to sync documents between two computers using WebSocket
 * 
 * Definitions:
 *  uTime - The date that the file was last modified AKA mTime
 *  syncPath - A shared identifier between the server and client that links folder in different directories together
 */
const WebSocket = require('ws')
const Path = require('path')
const fs = require('fs');
const { resolve } = require('path');
const { readdir } = require('fs').promises;
const appDataPath = process.env.APPDATA + '/' ;

// Enter servers ipAddress and desired port number
const ipAddress = "";
const portNumber = "";

/**
 *  Gets all filenames within given directory recursively
 * @param {The directory to get file names from} dir 
 */
async function getFiles(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    const res = resolve(dir, dirent.name);
    return dirent.isDirectory() ? getFiles(res) : res;
  }));
  return Array.prototype.concat(...files);
}

// Timer used to attempt a connection to the server
var sendTimer;

// Initial connection attempt to server to attempt to connect and start timer
attemptConnection();

/**
 * Attempts to connect to server using given address and port
 */
function attemptConnection(){
  var connection = new WebSocket("ws://" + ipAddress + ":" + portNumber + "");
  var fileSyncData;
  var settings;
  var loggedIn = false;

  /**
   * Loads local settings and file data into fileSyncData and settings variables
   */
  function updateData(){
    fileSyncData = JSON.parse(fs.readFileSync(appDataPath + "FileSync/files.dat"));
    settings = JSON.parse(fs.readFileSync(appDataPath + "FileSync/settings.dat"));
  }

  // If the connection is made attempt to login to the server
  connection.onopen = () => {
    sendTimer = setInterval(() => {
      console.log("Connected to Server...")
      updateData();
      if (!loggedIn){
        // TODO: Use encrypted wss connection to prevent unencrypted passwords being compromised
        connection.send(JSON.stringify({
          type:"loginServer", // 
          secret:settings["pw"],
        }))
      }
      else{
        connection.send(JSON.stringify({
          type:"loginServer", // 
        }))
      }
    }, 60 * 1000)
  }

  connection.onerror = error => {
    /*
    * TODO: Handle connection errors
    * console.log("err")
    * setTimeout(attemptConnection, 10000)
    */
  }

  // If the connection is closed attempt to reconnect every 60 seconds
  connection.onclose = event =>{
    console.log("Waiting for connection...")
    clearInterval(sendTimer);
    setTimeout(attemptConnection, 60 * 1000);
  }

  /**
   * Given a relative path and a Sync Name returns the matching path on the clients PC
   * @param {The relative path given by the server} remotePath 
   * @param {The current syncName used to convert the relative path to a local path} syncName 
   */
  function getLocalPath(remotePath, syncName){
    return remotePath.replace(syncName, fileSyncData[syncName][settings["localMac"]]);
  }

  // TODO: add verification to confirm server is authentic and not malicious before accepting connections
  connection.on('message', message => {
    var payloadArgs = JSON.parse(message);
    // Logic tree based on the type of message recieved by the server
    if (payloadArgs["type"] == "loggedIn"){
      // Check get modified date of the persistent file and send to server
      for (var key of Object.keys(fileSyncData)) {
        var element = fileSyncData[key];

        if (element[settings["localMac"]]){
          if (element[settings["localMac"]]){
            console.log("Found a local directory to check...")
            var folderPath = element[settings["localMac"]]
            console.log(folderPath)
            var name = key;

            getFiles(folderPath).then(function (files) {
              console.log("Directory read successfully...")
              //listing all files using forEach
              var filesPayload = {} // filesPayload = {syncName:[serverFileDir, lastModifiedTime]}
              var fileLoop = 0;

              files.forEach(function (file) {
                fs.stat(file, function (err, stats) {
                  fileLoop++;
                  filesPayload[name + file.replace(folderPath, "")] = stats.mtime.getTime(); 
                  if (fileLoop == files.length){
                    connection.send(JSON.stringify({
                      type:"checkMTime", // Tells the server you are sending the last modified time of the file
                      files:filesPayload,
                      syncName:name
                    }))
                  }
                });
              });
            });
          }
        }
      }
    }
    else if (payloadArgs["type"] == "requestFile"){ // If the server is requesting a file, send the file contents, relative path, syncName, and last modified time
      fs.readFile(getLocalPath(payloadArgs["file"], payloadArgs["syncName"]), (err, fileContents) => {
        fs.stat(getLocalPath(payloadArgs["file"], payloadArgs["syncName"]), function (err, stats) { 
          connection.send(JSON.stringify({
            type:"updateFile",
            contents:fileContents.toString('base64'),
            filePath:payloadArgs["file"],
            syncName:payloadArgs["syncName"],
            uTime: stats.mtime.getTime()
          }))
        })
      })
    }
    /* If the server is sending us a file to update, ensure that the proper directories exist and then create the file, 
     * add the file content given by the server, and lastly modify the last modified time to the one given.
     */
    else if (payloadArgs["type"] == "updateFile"){ 
      fs.exists(Path.dirname(getLocalPath(payloadArgs["filePath"], payloadArgs["syncName"])), (exists) =>{
        if (!exists)
          fs.mkdir(Path.dirname(getLocalPath(payloadArgs["filePath"], payloadArgs["syncName"])), { recursive: true }, function (err) {
            writeFileSyncFile(payloadArgs["filePath"], payloadArgs["syncName"], payloadArgs["contents"], payloadArgs["uTime"]);
          });
        else
          writeFileSyncFile(payloadArgs["filePath"], payloadArgs["syncName"], payloadArgs["contents"], payloadArgs["uTime"]);
      })
    }
  })
}

/**
 * Write a file given by the server to the clients drive.
 * @param {Path of file one remote server} filePath 
 * @param {current Sync Name of file} syncName 
 * @param {Inner contents of file encoded in base64} contents 
 * @param {The last modified time of the file on the remote server} uTime 
 */
function writeFileSyncFile(filePath, syncName, contents, uTime){
  fs.writeFile(getLocalPath(filePath, syncName), contents, {encoding:'base64'}, (err) =>{
    if (!err){
      console.log(getLocalPath(filePath, syncName) + " written!")
      fs.utimes(getLocalPath(filePath, syncName), new Date(uTime), new Date(uTime), (err)=>{
        console.log(filePath + " had mTime set!")
      });
    }
  })
}
