const AWS = require('aws-sdk');
const GITHUB = require('@actions/github');

const CodeBuild = new AWS.CodeBuild();
const SecretsManager = new AWS.SecretsManager();

//config overrides
const GIT_SECRET_MANAGER_NAME = 'git-oauth-token',
    GIT_PAT_SECRET_KEY = 'GitPAT',
    GIT_OWNER = 'tamdilip',
    GIT_COMMIT_STATUS_CONTEXT = 'AWS CodeBuild - Test metrics check',
    GIT_COMMIT_STATUS_DESC = 'AWS CodeBuild to check ember test cases and coverage',
    COVERAGE_MIN_THRESHOLD = 90;

function responseBody(message) {
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
    };
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
        repo: repoInfo.REPO,
        sha: repoInfo.COMMIT_ID,
        state: repoInfo.state,
        context: GIT_COMMIT_STATUS_CONTEXT,
        description: GIT_COMMIT_STATUS_DESC,
        target_url: repoInfo.target_url
    });
}

async function postGitComment(repoInfo) {
    let octokit = await getGitConnection();
    return octokit.issues.createComment({
        owner: GIT_OWNER,
        repo: repoInfo.REPO,
        issue_number: repoInfo.PR_NUMBER,
        body: repoInfo.commentBody
    });
};

function getCommentBody(reportInfo) {
    let { testSummary, coverageSummary, testsPassed, coverageThresholdPassed, testReportURL, coverageReportURL } = reportInfo,
        { SUCCEEDED, SKIPPED, FAILED } = testSummary,
        { branchCoveragePercentage, lineCoveragePercentage } = coverageSummary;

    let testLabel = `[![Test report](${encodeURI(`https://img.shields.io/badge/Tests-${SUCCEEDED} passed, ${FAILED} failed, ${SKIPPED} skipped-${testsPassed ? 'brightgreen' : 'red'}`)})](${testReportURL})`,
        coverageLabel = `[![Coverage report](${encodeURI(`https://img.shields.io/badge/Coverage-Lines--${lineCoveragePercentage}%, Branches--${branchCoveragePercentage}%-${coverageThresholdPassed ? 'brightgreen' : 'red'}`)})](${coverageReportURL})`;

    return `${testLabel} ${coverageLabel}`;
}

function getReportInfo(data) {
    return data.reports.reduce((acc, val) => {
        if (val.type === 'TEST') {
            let { testSummary: { statusCounts }, arn } = val;
            let { FAILED } = statusCounts;

            let arnWithName = arn.split('/')[1];
            let reportName = arnWithName.split(':')[0];
            let testReportURL = encodeURI(`https://console.aws.amazon.com/codesuite/codebuild/testReports/reports/${reportName}/${arnWithName}`);

            acc.testSummary = statusCounts;
            acc.testsPassed = FAILED == 0;
            acc.testReportURL = testReportURL;
        }
        if (val.type === 'CODE_COVERAGE') {
            let { codeCoverageSummary, arn } = val;

            let arnWithName = arn.split('/')[1];
            let reportName = arnWithName.split(':')[0];
            let coverageReportURL = encodeURI(`https://console.aws.amazon.com/codesuite/codebuild/testReports/reports/${reportName}/${arnWithName}`);

            acc.coverageReportURL = coverageReportURL;
            acc.coverageSummary = codeCoverageSummary;
            acc.coverageThresholdPassed = codeCoverageSummary.lineCoveragePercentage > COVERAGE_MIN_THRESHOLD && codeCoverageSummary.branchCoveragePercentage > COVERAGE_MIN_THRESHOLD;
        }
        return acc;
    }, {});
}

async function getcodeBuildReports(reportArns) {
    return new Promise((resolve) => {
        CodeBuild.batchGetReports({ reportArns }, async function (err, data) {
            if (err) {
                console.log(err, err.stack);
                resolve(null);
            }
            else {
                resolve(data);
            }
        });
    });
}

exports.handler = async (event, context, callback) => {
    try {
        const { detail: { 'build-status': buildStatus, 'additional-information': { reportArns, logs: { 'deep-link': cloudwatchBuildLogURL }, environment: { 'environment-variables': environmentVariables } } } } = event;

        let gitRepoInfo = environmentVariables.reduce((acc, envValue) => {
            acc[envValue.name] = envValue.value;
            return acc;
        }, {});
        gitRepoInfo.state = 'failure';
        gitRepoInfo.target_url = cloudwatchBuildLogURL;

        let buildReport = await getcodeBuildReports(reportArns);

        if (buildReport) {
            let reportInfo = getReportInfo(buildReport),
                commentBody = getCommentBody(reportInfo),
                { testsPassed, coverageThresholdPassed } = reportInfo;
            gitRepoInfo.commentBody = commentBody;

            if (buildStatus === 'SUCCEEDED' && testsPassed && coverageThresholdPassed)
                gitRepoInfo.state = 'success';

            await postGitComment(gitRepoInfo);
        }
        await updateCommitStatus(gitRepoInfo);
        callback(null, responseBody('PR-validated !!'));
    } catch (error) {
        callback(null, responseBody(error));
    }
};
