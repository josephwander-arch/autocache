# Signing the Autocache extension

The Autocache bundle contains no executable (it is JavaScript run by Claude Desktop's
Node.js), so there is no Authenticode step. The only signature is the MCPB bundle signature,
which Claude Desktop shows as signed or unsigned.

`mcpb sign` needs a PEM certificate and PEM private key. Azure Trusted Signing (the AIWander
`cpc-signing` profile used for Windows executables) does not hand out private keys, so the
bundle signature needs a separate code-signing certificate exported as PEM.

## The two commands

Run from a PowerShell 7 prompt in the repository root, with the certificate files in place:

```powershell
pwsh -NoProfile -File adapters\local-hosts\mcpb\pack.ps1 -Clean -Sign -McpbCert C:\keys\mcpb-cert.pem -McpbKey C:\keys\mcpb-key.pem
mcpb verify adapters\local-hosts\mcpb\dist\autocache-0.5.0-win.mcpb
```

Add `-McpbIntermediate <pem>` if the chain needs an intermediate. Without `-McpbCert` and
`-McpbKey`, `-Sign` only warns and the bundle stays unsigned.

Signing changes the bundle, so `SHA256SUMS.txt` is rewritten by the same run; upload the new
`.mcpb` and the new `SHA256SUMS.txt` together.
