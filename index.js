const { google } = require("googleapis");
const credentials = require("./credentials.json");
const {
    isAllowed,
    STAGING_API_DOMAIN,
    BLOG_FOLDER,
    RECIPE_FOLDER,
    DO_NOT_PUBLISH,
    AUTHOR_NAMES
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
async function listFiles(drive, searchOptions = { pageSize: 10 }) {
    return new Promise((resolve, reject) => {
        drive.files.list({
            ...searchOptions,
            fields: "nextPageToken, files(mimeType, id, name, owners, description, createdTime, modifiedTime, parents)",
        }, (err, res) => {
            if (err) return reject("The API returned an error: " + err);
            const files = res.data.files;
            if (files.length) {
                return resolve(files);
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
        path,
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

    const searchFolder = path.includes("recipes") ? RECIPE_FOLDER : BLOG_FOLDER;
    const pageSize = path.includes("recipes") ? 100 : 20;

    const response = {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Cache-Control": "max-age=3600, stale-while-revalidate=86400"
        },
        multiValueHeaders: {}
    };

    try {
        const client = await google.auth.getClient({
            credentials,
            scopes: SCOPES
        });
        const drive = google.drive({ version: 'v3', auth: client });

        if (!post) {
            const files = await listFiles(drive, { q: `mimeType='text/markdown' and '${ searchFolder }' in parents`, pageSize });

            response.body = JSON.stringify(files.map((file) => ({
                name: file.name.split(".")[0],
                description: file.description,
                createdTime: new Date(file.createdTime).getTime(),
                modifiedTime: new Date(file.modifiedTime).getTime(),
                author: AUTHOR_NAMES[file.owners[0].displayName] || file.owners[0].displayName
            })).filter(({ name }) => !DO_NOT_PUBLISH.includes(name)));

            return response;
        }

        // assumes file lists are sorted in the same order they are displayed in the drive folder, most recently modified first
        if (post === "latest") {
            const files = await listFiles(drive, { q: `mimeType='text/markdown' and '${ searchFolder }' in parents`, pageSize: 1 });

            const file = files[0];

            response.body = JSON.stringify({
                name: file.name.split(".")[0],
                description: file.description,
                content: await getFile(drive, file.id),
                createdTime: new Date(file.createdTime).getTime(),
                modifiedTime: new Date(file.modifiedTime).getTime(),
                author: AUTHOR_NAMES[file.owners[0].displayName] || file.owners[0].displayName
            });

            return response;
        }

        const files = await listFiles(drive, { q: `mimeType='text/markdown' and name = '${ post }.md'`, pageSize: 1 });

        const found = files[0];

        response.body = JSON.stringify({
            name: post,
            description: found.description,
            content: await getFile(drive, found.id),
            createdTime: new Date(found.createdTime).getTime(),
            modifiedTime: new Date(found.modifiedTime).getTime(),
            author: AUTHOR_NAMES[found.owners[0].displayName] || found.owners[0].displayName
        });

        return response;
    } catch (error) {
        return {
            statusCode: 404,
            headers: {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true"
            },
            body: JSON.stringify(error),
        };
    }
};