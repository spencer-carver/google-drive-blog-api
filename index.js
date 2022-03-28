const { google } = require("googleapis");
const { file } = require("googleapis/build/src/apis/file");
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
            pageSize: 20,
            fields: "nextPageToken, files(mimeType, id, name, description, createdTime, modifiedTime)",
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

    const { post } = pathParameters || {};

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
            response.body = JSON.stringify(files.map((file) => ({
                name: file.name.split(".")[0],
                description: file.description,
                createdTime: new Date(file.createdTime).getTime(),
                modifiedTime: new Date(file.modifiedTime).getTime()
            })));

            return response;
        }

        // assumes file lists are sorted in the same order they are displayed in the drive folder, most recently modified first
        if (post === "latest") {
            const file = files[0];

            response.body = JSON.stringify({
                name: file.name.split(".")[0],
                description: file.description,
                content: await getFile(drive, file.id),
                createdTime: new Date(file.createdTime).getTime(),
                modifiedTime: new Date(file.modifiedTime).getTime()
            });

            return response;
        }

        const found = files.find(({ name }) => name.split(".")[0] === post);

        response.body = JSON.stringify({
            name: post,
            description: found.description,
            content: await getFile(drive, found.id),
            createdTime: new Date(found.createdTime).getTime(),
            modifiedTime: new Date(found.modifiedTime).getTime()
        });

        return response;
    } catch (error) {
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true"
            },
            body: JSON.stringify(error),
        };
    }
};