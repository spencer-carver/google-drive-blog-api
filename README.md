# Google Drive Blog Export
This is designed to be an AWS Lambda that sits behind my site API Gateway, and uses a GCP service account that has permissions to view a special Google Drive folder to manage my blog contents.

The `credentials.json` file (not checked in) provides details for this service account to perform actions

The `npm run export` script zips up required files to be imported into the desired lambda function from the AWS Console.
