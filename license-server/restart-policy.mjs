export const updateRestartExitCode = 75;

export function shouldRestartAfterExit(code) {
  return code === updateRestartExitCode;
}
