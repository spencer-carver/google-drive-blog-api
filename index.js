const { drive: createDrive } = require("@googleapis/drive");
const { GoogleAuth } = require("google-auth-library");
const credentials = require("./credentials.json");
const {
    isAllowed,
    STAGING_API_DOMAIN,
    BLOG_FOLDER,
    RECIPE_FOLDER,
    DO_NOT_PUBLISH,
    AUTHOR_NAMES
} = require("./private-helpers");

const SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly"
];

// Served by CloudFront: fresh for 15 minutes, then served stale instantly (and refreshed in the background)
// for up to 30 days, including when this function errors.
const CACHE_CONTROL = "max-age=900, stale-while-revalidate=2592000, stale-if-error=2592000";

// Only plain file-name style identifiers are allowed in a post name, since it is used in a Drive search query.
const VALID_POST_NAME = /^[A-Za-z0-9_-]+$/;

// How long (per warm Lambda container) file metadata lookups are reused.
const METADATA_CACHE_TTL_MS = 60 * 1000;

// Created once per container, so warm invocations reuse the client and its cached access token.
const auth = new GoogleAuth({ credentials, scopes: SCOPES });
const drive = createDrive({ version: "v3", auth });

const metadataCache = new Map();

class NotFoundError extends Error {}

async function cached(key, loader) {
    const hit = metadataCache.get(key);

    if (hit && Date.now() - hit.time < METADATA_CACHE_TTL_MS) {
        return hit.value;
    }

    const value = await loader();

    metadataCache.set(key, { time: Date.now(), value });

    return value;
}

async function listFiles(searchOptions = { pageSize: 10 }) {
    const res = await drive.files.list({
        ...searchOptions,
        fields: "nextPageToken, files(mimeType, id, name, owners, description, createdTime, modifiedTime, parents)",
    });

    return res.data.files || [];
}

async function getFile(fileId) {
    const res = await drive.files.get({
        fileId,
        mimeType: "text/plain",
        alt: "media"
    });

    return res.data;
}

function isPublished(file) {
    return !DO_NOT_PUBLISH.includes(file.name.split(".")[0]);
}

function toMetadata(file, name = file.name.split(".")[0]) {
    return {
        name,
        description: file.description || "",
        createdTime: new Date(file.createdTime).getTime(),
        modifiedTime: new Date(file.modifiedTime).getTime(),
        author: AUTHOR_NAMES[file.owners[0].displayName] || file.owners[0].displayName
    };
}

function listFolder(searchFolder, pageSize) {
    return cached(`list:${ searchFolder }:${ pageSize }`, () => listFiles({
        q: `mimeType='text/markdown' and '${ searchFolder }' in parents`,
        pageSize
    }));
}

function findPost(searchFolder, post) {
    return cached(`post:${ searchFolder }:${ post }`, async () => {
        const files = await listFiles({
            q: `mimeType='text/markdown' and '${ searchFolder }' in parents and name = '${ post }.md'`,
            pageSize: 1
        });

        return files[0];
    });
}

exports.handler = async (event) => {
    const {
        headers = {},
        path = "",
        pathParameters,
        requestContext = {}
    } = event;

    const origin = headers.origin || headers.Origin;

    if ((!origin && requestContext.domainName !== STAGING_API_DOMAIN) || (origin && !isAllowed(origin))) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: "CORS error" })
        };
    }

    const corsHeaders = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true"
    };

    const response = {
        statusCode: 200,
        headers: {
            ...corsHeaders,
            "Cache-Control": CACHE_CONTROL
        },
        multiValueHeaders: {}
    };

    try {
        const { post } = pathParameters || {};

        const isRecipes = path.includes("recipes");
        const searchFolder = isRecipes ? RECIPE_FOLDER : BLOG_FOLDER;
        const pageSize = isRecipes ? 100 : 20;

        if (!post) {
            const files = await listFolder(searchFolder, pageSize);

            response.body = JSON.stringify(files.filter(isPublished).map((file) => toMetadata(file)));

            return response;
        }

        let file;
        let name;

        // assumes file lists are sorted in the same order they are displayed in the drive folder, most recently modified first
        if (post === "latest") {
            file = (await listFolder(searchFolder, pageSize)).find(isPublished);
            name = file && file.name.split(".")[0];
        } else {
            if (!VALID_POST_NAME.test(post) || DO_NOT_PUBLISH.includes(post)) {
                throw new NotFoundError();
            }

            file = await findPost(searchFolder, post);
            name = post;
        }

        if (!file) {
            throw new NotFoundError();
        }

        response.body = JSON.stringify({
            ...toMetadata(file, name),
            content: await getFile(file.id)
        });

        return response;
    } catch (error) {
        if (error instanceof NotFoundError) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: "Not found" })
            };
        }

        console.log(error);

        // 5xx so CloudFront can serve a stale copy (stale-if-error) rather than caching a failure
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: "Unexpected error." })
        };
    }
};
