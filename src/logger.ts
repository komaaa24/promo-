type LogContext = Record<string, unknown>;
type LogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  time: string;
  context?: LogContext;
};

const recentLogs: LogEntry[] = [];
const maxRecentLogs = 300;

function write(level: "info" | "warn" | "error", message: string, context?: LogContext): void {
  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...(context ? { context } : {}),
  };

  recentLogs.push(payload);
  if (recentLogs.length > maxRecentLogs) {
    recentLogs.shift();
  }

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};

export function getRecentLogs(limit = 100): LogEntry[] {
  return recentLogs.slice(-limit).reverse();
}
