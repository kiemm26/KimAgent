// src/logger.ts
// Pure synchronous structured logger — 0 worker threads, 0 dependencies, zero-hang
type LogArg = Record<string, unknown> | string;

function formatLog(level: string, objOrMsg: LogArg, maybeMsg?: string): void {
  const time = new Date().toISOString();
  if (typeof objOrMsg === "string") {
    console.log(JSON.stringify({ level, time, msg: objOrMsg }));
  } else if (typeof maybeMsg === "string") {
    console.log(JSON.stringify({ level, time, msg: maybeMsg, ...objOrMsg }));
  } else {
    console.log(JSON.stringify({ level, time, ...objOrMsg }));
  }
}

export const logger = {
  info: (a: LogArg, b?: string): void => formatLog("INFO", a, b),
  warn: (a: LogArg, b?: string): void => formatLog("WARN", a, b),
  error: (a: LogArg, b?: string): void => formatLog("ERROR", a, b),
  debug: (a: LogArg, b?: string): void => {
    if (process.env["LOG_LEVEL"] === "debug") formatLog("DEBUG", a, b);
  },
  fatal: (a: LogArg, b?: string): void => formatLog("FATAL", a, b),
};


