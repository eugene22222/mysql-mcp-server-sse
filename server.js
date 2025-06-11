// server.js 개선 버전 (MCP stdio to SSE 안정화)

import express from 'express';
import { spawn } from 'child_process';

const app = express();
const port = 3001;

app.get('/sse', (req, res) => {
  const dbUrl = req.query.db_url;

  if (!dbUrl) {
    res.status(400).send('Missing db_url query parameter');
    return;
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  res.flushHeaders();

  console.log(`Spawning MCP process with DB URL: ${dbUrl}`);

  const mcpProcess = spawn('npx', ['-y', '@davewind/mysql-mcp-server', dbUrl]);

  mcpProcess.stdout.on('data', (data) => {
    const raw = data.toString().trim();

    // Split multiple JSON objects in one chunk (if any)
    const lines = raw.split(/\r?\n/);

    lines.forEach((line) => {
      try {
        const json = JSON.parse(line);
        res.write(`data: ${JSON.stringify(json)}\n\n`);
      } catch (err) {
        console.error('Invalid JSON chunk skipped:', line);
        // Optionally, you can send raw line (not recommended)
        // res.write(`data: ${line}\n\n`);
      }
    });
  });

  mcpProcess.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  mcpProcess.on('close', (code) => {
    res.write(`event: end\ndata: MCP server exited with code ${code}\n\n`);
    res.end();
  });

  req.on('close', () => {
    console.log('Client disconnected, killing MCP process.');
    mcpProcess.kill();
  });
});

app.listen(port, () => {
  console.log(`SSE server listening at http://localhost:${port}/sse`);
});
