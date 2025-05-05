let buffer = '';
let parsedLogsBuffer = [];
let timeoutId = null;
const BATCH_INTERVAL = 150; // Send batches every 150ms
const BATCH_SIZE = 200; // Or when batch size reaches 200

// Regex to parse log lines (should match the one in the component)
// threadtime 格式: "MM-DD HH:mm:ss.SSS  PID  TID LEVEL/TAG: MESSAGE" 或 "MM-DD HH:mm:ss.SSS  PID  TID LEVEL TAG: MESSAGE"
const logRegex = /(\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEAF])\s+([^:]+?):\s+(.+)/;

function parseLogLine(line) {
  const match = line.match(logRegex);
  if (match) {
    const [, timestamp, pid, tid, level, tag, message] = match;
    return {
      timestamp,
      pid,
      tid,
      level,
      tag,
      message,
      key: `${timestamp}-${pid}-${tid}-${tag}-${Math.random()}`
    };
  }
  // console.log('Worker: 无法解析的日志行:', line); // Uncomment for debugging
  return null;
}

function sendBatch() {
  if (parsedLogsBuffer.length > 0) {
    self.postMessage({ type: 'logs', payload: parsedLogsBuffer });
    parsedLogsBuffer = [];
  }
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

self.onmessage = (event) => {
  if (event.data.type === 'process') {
    const data = event.data.payload;
    buffer += data;
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep the potentially incomplete last line

    if (lines.length > 0) {
      const newlyParsed = lines
        .map(parseLogLine)
        .filter(Boolean);

      if (newlyParsed.length > 0) {
        parsedLogsBuffer.push(...newlyParsed);

        // Send immediately if batch size is reached
        if (parsedLogsBuffer.length >= BATCH_SIZE) {
          sendBatch();
        } else if (!timeoutId) {
          // Otherwise, schedule a batch send
          timeoutId = setTimeout(sendBatch, BATCH_INTERVAL);
        }
      }
    }
  } else if (event.data.type === 'clear') {
      // Clear buffer and scheduled sends if main thread requests it
      buffer = '';
      parsedLogsBuffer = [];
      if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
      }
  }
};

// Ensure any remaining logs are sent before the worker potentially terminates
self.onclose = () => {
  sendBatch(); 
}; 