# Public demonstration repository

- Keep all distributed sample data and tests fictional. Do not copy operational spreadsheets, real results, real orders, personal names/emails, private site URLs, administrative links, credentials or live hosting identifiers. The public repository and demo destination URLs may use the hosting account handle; do not put personal identities in examples or labels.
- Use generic identities `owner` and `developer`, and reserved example domains for fixtures.
- Preserve the prominent fictitious-data notice in the README and interface. Targets in this version are illustrative, not production targets.
- Synchronize future panel improvements only after sanitizing the public copy. Never copy production Git history or overwrite the sanitized copy with an unreviewed snapshot.
- Keep production access configuration and data separate. Publishing this repository does not deploy the production site.
- Run the build and applicable synthetic tests before pushing.
- Keep the public online demo synchronized: build the static demonstration and publish its output on `gh-pages`. Do not publish the backend, real bases or hosting credentials on that branch. Preserve relative asset paths for hosting under a project subdirectory.
- README must lead with the online demonstration link. Explain that `127.0.0.1` only works after the reader starts a local server on their own computer.
