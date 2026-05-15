# Security Policy

## Public Repository Rule

This repository is public. Treat every issue, pull request, discussion,
commit, example, and log excerpt as publicly visible.

Do not include secrets or private operational data.

## Never Share

- Private keys
- Seed phrases
- Wallet secret material
- API keys
- Filebase credentials
- Production environment variables
- Private database URLs
- Private RPC URLs with embedded tokens
- Private PlotLink admin endpoints
- Customer/user private data
- Real unpublished story drafts unless explicitly approved for public use

## Use Placeholders

Use placeholder environment variable names in tickets and documentation:

- `PLOTTOON_PLOTLINK_API_URL`
- `PLOTTOON_UPLOAD_ENDPOINT`
- `PLOTTOON_WALLET_KEY_PATH`
- `PLOTTOON_SIGNING_MODE`
- `PLOTTOON_FILEBASE_TOKEN`
- `PLOTTOON_RPC_URL`

## Operator Gates

If a task needs credentials, wallet access, production endpoints, or a real
publish target, create or use an Operator Gate task. The Operator Gate should
ask the operator to configure secrets locally or through the approved secret
manager. It must not ask the operator to paste secrets into GitHub.

## Reporting a Vulnerability

Open a private communication channel with the repository owner before sharing
details that may expose credentials, wallet material, or exploitable behavior.

