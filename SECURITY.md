# Security

Please report vulnerabilities privately, using **Report a vulnerability** on this repository's [Security tab](https://github.com/atomica-software/contactzilla-js-api-client/security), rather than in a public issue.

This package has no runtime dependencies. It never logs tokens, and it sends a token only in the `Authorization` header of requests to the base URL you configure. Keep tokens server-side: in a browser, anyone who can use the page can read them.
