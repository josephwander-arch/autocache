#!/usr/bin/env node
// Both transports are imported lazily INSIDE the try: the import chain
// evaluates runtime.js, whose fail-closed startup throw must land in the
// catch below (friendly stderr + exitCode 1), not as a raw module-load stack.
const mode = String(process.argv[2] || 'stdio').toLowerCase();

try {
  if (mode === 'stdio') {
    const { runStdio } = await import('./stdio.js');
    await runStdio();
  } else if (mode === 'http') {
    const { startHttpServer } = await import('./http.js');
    const running = await startHttpServer();
    process.stderr.write(`AutoCache MCP listening at ${running.url.href}\n`);

    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      try { await running.close(); } catch { /* process is exiting */ }
      process.exitCode = 0;
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } else {
    throw new Error('usage: node src/cli.js [stdio|http]');
  }
} catch (error) {
  process.stderr.write(`AutoCache MCP failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
}
