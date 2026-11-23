export function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error('任务已停止');
}
