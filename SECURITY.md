# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

- Use GitHub's **Report a vulnerability** button on the [Security tab](https://github.com/versyka/versyka-action/security) of this repository, or
- email **karthik@versyka.com** with "Security" in the subject.

Include what you found, how to reproduce it, and the version (tag) you used.

We reply within 3 working days and always within 14 days. We fix confirmed problems in a new release as soon as we can, credit you in the release notes if you'd like, and publish an advisory once a fix is out.

## Supported versions

Security fixes go into the latest `v1` release. The `v1` tag always points to it, so workflows using `versyka/versyka-action@v1` get fixes automatically.

## What the action does with your code

Your source code never leaves the runner. Only dependency manifests (package.json, requirements.txt, pyproject.toml, Pipfile) are sent to the Versyka upgrade check, over HTTPS. The action has no dependencies and uses only the token you give it, to post one pull request comment.
