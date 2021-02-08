const AWS = require('aws-sdk');
const crypto = require('crypto');
const GITHUB = require('@actions/github');

const CodeBuild = new AWS.CodeBuild();
const SecretsManager = new AWS.SecretsManager();

//config overrides
const CODEBUILD_NAME = 'node-js-test',
    GIT_SECRET_MANAGER_NAME = 'git-oauth-token',
    GIT_PAT_SECRET_KEY = 'GitPAT',
    GIT_WEBHOOK_SECRET_KEY = 'GithubWebhookSecretKey',
    GIT_OWNER = 'tamdilip',
    GIT_COMMIT_STATUS_CONTEXT = 'AWS CodeBuild - Test metrics check',
    GIT_COMMIT_STATUS_DESC = 'AWS CodeBuild to check ember test cases and coverage';


function responseBody(message) {
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
    };
}

let webhookSecretKey;
async function verifySignature(sha, payload) {
    webhookSecretKey = webhookSecretKey || await getSecretValue(GIT_SECRET_MANAGER_NAME, GIT_WEBHOOK_SECRET_KEY);
    const hmac = crypto.createHmac('sha1', webhookSecretKey);
    const digest = Buffer.from('sha1=' + hmac.update(JSON.stringify(payload)).digest('hex'), 'utf8');
    const checksum = Buffer.from(sha, 'utf8');

    return checksum.length === digest.length && crypto.timingSafeEqual(digest, checksum);
}

async function getSecretValue(SecretId, SecretKey) {
    return new Promise((resolve, reject) => {
        SecretsManager.getSecretValue({ SecretId }, function (err, data) {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            } else {
                resolve(JSON.parse(data.SecretString)[SecretKey]);
            }
        });
    });
}

let gitAuthToken, gitConnection;
async function getGitConnection() {
    gitAuthToken = gitAuthToken || await getSecretValue(GIT_SECRET_MANAGER_NAME, GIT_PAT_SECRET_KEY);
    gitConnection = gitConnection || GITHUB.getOctokit(gitAuthToken);
    return gitConnection;
}

async function updateCommitStatus(repoInfo) {
    let octokit = await getGitConnection();
    return octokit.repos.createCommitStatus({
        owner: GIT_OWNER,
        repo: repoInfo.repoName,
        sha: repoInfo.commitId,
        state: repoInfo.state,
        context: GIT_COMMIT_STATUS_CONTEXT,
        description: GIT_COMMIT_STATUS_DESC,
        target_url: repoInfo.target_url
    });
}

exports.handler = (event, context, callback) => {
    try {
        const { headers: { 'X-Hub-Signature': webhookSecretSignature, 'X-GitHub-Event': githubEvent }, body } = event,
            validPrStatus = ['opened', 'reopened', 'synchronize'],
            requestBody = JSON.parse(body);

        if (githubEvent === 'pull_request' && validPrStatus.includes(requestBody.action) && await verifySignature(webhookSecretSignature, requestBody)) {
            let {
                number: prNumber,
                repository: { name: repoName },
                pull_request: { head: { ref: branchName, sha: commitId } }
            } = requestBody,
                codeBuildParams = {
                    projectName: CODEBUILD_NAME,
                    environmentVariablesOverride: [
                        {
                            name: 'REPO',
                            value: `${repoName}`
                        },
                        {
                            name: 'BRANCH_NAME',
                            value: `${branchName}`
                        },
                        {
                            name: 'PR_NUMBER',
                            value: `${prNumber}`
                        },
                        {
                            name: 'COMMIT_ID',
                            value: `${commitId}`
                        }
                    ]
                };

            let repoInfo = { repoName, commitId };
            CodeBuild.startBuild(codeBuildParams, async function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                    repoInfo.state = 'failure';
                    repoInfo.target_url = 'https://console.aws.amazon.com/cloudwatch/home';
                    await updateCommitStatus(repoInfo);
                    callback(null, responseBody(err));
                }
                else {
                    let { build: { id, logs: { deepLink } } } = data;
                    let [buildName, buildId] = id.split(':');

                    repoInfo.state = 'pending';
                    repoInfo.target_url = encodeURI(deepLink.replace('null', `/aws/codebuild/${buildName}`).replace('null', buildId));

                    await updateCommitStatus(repoInfo);
                    callback(null, responseBody(data));
                }
            });
        } else {
            callback(null, responseBody('Invalid Request'));
        }
    } catch (error) {
        callback(null, responseBody(error));
    }
};
