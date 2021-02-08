# 🔫 aws-git-pull-request-review
Architecture to integrate git repositories with AWS services via webhook to validate pull-requests for code reviews and coverage quality. 

For every pull-request and consecutive commits on PR, github webhkook will trigger an API gateway which is bound to a lambda where the payload will be extracted and a codebuild will be triggered which will save the test and coverage reports as part of codebuild report groups and a cloudwatch event will trigger another lambda on build completion to update PR commit staus and post a comment with metrics.

## Architecture
![architecture](https://raw.githubusercontent.com/tamdilip/aws-git-pull-request-review/main/docs/git-aws-architecture.jpg)

### Setup
- Create two lambdas - [pre-pr-build-lambda](https://github.com/tamdilip/aws-git-pull-request-review/tree/main/pre-pr-build-lambda) and [post-pr-build-lambda](https://github.com/tamdilip/aws-git-pull-request-review/tree/main/post-pr-build-lambda) (override necessary config values inside).
- Create a [codebuild](https://github.com/tamdilip/aws-git-pull-request-review/blob/main/cloudformation-for-codebuild-reports-with-cloudwatch-events.yaml#L1-L60) enabled with report groups.
- Create a [cloudwatch event](https://github.com/tamdilip/aws-git-pull-request-review/blob/main/cloudformation-for-codebuild-reports-with-cloudwatch-events.yaml#L61-L95) to trigger [post-pr-build-lambda](https://github.com/tamdilip/aws-git-pull-request-review/tree/main/post-pr-build-lambda)
- Create an API Gateway mapped to [pre-pr-build-lambda](https://github.com/tamdilip/aws-git-pull-request-review/tree/main/pre-pr-build-lambda)
- Configure Github repo webhook with API Gateway URL and the secret key used inside [pre-pr-build-lambda](https://github.com/tamdilip/aws-git-pull-request-review/tree/main/pre-pr-build-lambda)

### 📽 Codebuild - Test report group
![test report](https://raw.githubusercontent.com/tamdilip/aws-git-pull-request-review/main/docs/aws-reports-group-test.jpeg)

### 📽 Codebuild - Coverage report group
![coverage report](https://raw.githubusercontent.com/tamdilip/aws-git-pull-request-review/main/docs/aws-reports-group-coverage.jpeg)

### 📽 Github - Pull-Request review comment and status
![pr status](https://raw.githubusercontent.com/tamdilip/aws-git-pull-request-review/main/docs/review-comment.png)

**Happy coding :) !!**
