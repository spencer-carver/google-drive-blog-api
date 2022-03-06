const { google } = require("googleapis");
const credentials = require("./credentials.json");
const {
    isAllowed,
    STAGING_API_DOMAIN
} = require("./private-helpers");

// If modifying these scopes, delete token.json.
const SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly"
];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.

/**
 * Lists the names and IDs of up to 10 files.
 */
async function listFiles(drive) {
    return new Promise((resolve, reject) => {
        drive.files.list({
            pageSize: 10,
            fields: "nextPageToken, files(mimeType, id, name)",
        }, (err, res) => {
            if (err) return reject("The API returned an error: " + err);
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
            mimeType: "text/plain",
            alt: "media"
        }, (err, res) => {
            if (err) return reject("The API returned an error: " + err);
            return resolve(res.data);
        });
    });
}

exports.handler = async (event) => {
    console.log(event);
    const {
        headers,
        pathParameters,
        requestContext
    } = event;

    const origin = headers.origin || headers.Origin;

    if ((!origin && requestContext.domainName !== STAGING_API_DOMAIN) || (origin && !isAllowed(origin))) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: "CORS error" })
        };
    }

    const { post } = pathParameters;

    const response = {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true"
        },
        multiValueHeaders: {}
    };

    try {
        const client = await google.auth.getClient({
            credentials,
            scopes: SCOPES
        });
        const drive = google.drive({ version: 'v3', auth: client });
        const files = await listFiles(drive);

        if (!post) {
            response.body = JSON.stringify(files.map(({ name }) => name.split(".")[0]));

            return response;
        }

        // assumes file lists are sorted in the same order they are displayed in the drive folder, most recently modified first
        if (post === "latest") {
            response.body = JSON.stringify(await getFile(drive, files[0].id));

            return response;
        }

        const found = files.find(({ name }) => name.indexOf(post) === 0);

        response.body = JSON.stringify(await getFile(drive, found.id));

        return response;
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify(error),
        };
    }
};