// Optional existing private config; never copy or print credentials.
if (process.env.FRAME_ENV_FILE) process.loadEnvFile(process.env.FRAME_ENV_FILE);
process.argv = [
  process.argv[0],
  "next",
  "dev",
  "--hostname",
  "127.0.0.1",
  "--port",
  "4310",
];
await import("next/dist/bin/next");
