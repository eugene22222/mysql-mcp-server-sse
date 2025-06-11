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

  let buffer = '';
  let currentBlocks = [];
  let currentIndex = 0;
  let totalBlocks = 0;

  const mergeContentBlocks = (blocks) => {
    if (blocks.length === 0) return {};

    // Assuming all blocks have similar structure
    const merged = { ...blocks[0] };
    merged.fields = {};

    blocks.forEach((block) => {
      Object.assign(merged.fields, block.fields);
    });

    delete merged.contentBlockIndex;
    delete merged.contentBlockCount;

    return merged;
  };

  mcpProcess.stdout.on('data', (data) => {
    buffer += data.toString();

    let boundary = buffer.indexOf('\n');
    while (boundary !== -1) {
      const line = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);

      try {
        const json = JSON.parse(line);

        if (json.type === 'contentBlock') {
          if (json.contentBlockIndex === 0) {
            currentBlocks = [json];
            currentIndex = 1;
            totalBlocks = json.contentBlockCount;
          } else {
            currentBlocks.push(json);
            currentIndex++;
          }

          // If all blocks collected -> send as one message
          if (currentIndex === totalBlocks) {
            const merged = mergeContentBlocks(currentBlocks);
            res.write(`data: ${JSON.stringify(merged)}\n\n`);
            currentBlocks = [];
            currentIndex = 0;
            totalBlocks = 0;
          }

        } else {
          console.log('Skipping non-contentBlock:', json.type);
        }
      } catch (err) {
        console.error('Invalid JSON chunk skipped:', line);
      }

      boundary = buffer.indexOf('\n');
    }
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
