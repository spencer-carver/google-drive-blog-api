const {google} = require('googleapis');
const credentials =require('./credentials.json');

// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly'
];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.

async function getAuthClient() {
    return await google.auth.getClient({
        credentials,
        scopes: SCOPES
    });
}

/**
 * Lists the names and IDs of up to 10 files.
 */
async function listFiles(drive) {
  return new Promise((resolve, reject) => {
    drive.files.list({
      pageSize: 10,
      fields: 'nextPageToken, files(mimeType, id, name)',
    }, (err, res) => {
      if (err) return reject('The API returned an error: ' + err);
      const files = res.data.files;
      if (files.length) {
        return resolve(files.filter((file) => file.mimeType === "text/markdown"));
      } else {
        return resolve([]);
      }
    });
  });
}

async function getFile(drive, fileId) {
    return new Promise((resolve, reject) => {
        drive.files.get({
            fileId,
            mimeType: 'text/plain',
            alt: "media"
        }, (err, res) => {
            if (err) return reject('The API returned an error: ' + err);
            return resolve(res.data);
        });
    });
}

exports.handler = async (event) => {
  try {
    const client = await getAuthClient();
    const drive = google.drive({version: 'v3', auth: client});

    if (event.type === "get") {
        return {
            statusCode: 200,
            body: JSON.stringify(await getFile(drive, event.id)),
          };
    }

    const files = await listFiles(drive);

    if (event.type === "list") {
        return {
            statusCode: 200,
            body: JSON.stringify(files.map(file => file.name)),
        };
    }

    // assumes file lists are sorted in the same order they are displayed in the drive folder, most recently modified first
    if (event.type === "latest") {
        return {
            statusCode: 200,
            body: JSON.stringify(await getFile(drive, files[0].id)),
        };
    }
  } catch (error) {
    return {
        statusCode: 500,
        body: JSON.stringify(error),
    };
  }
};