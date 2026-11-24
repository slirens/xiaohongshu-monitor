import { t } from './i18n.mjs';

export function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error(t('任务已停止', 'Task stopped'));
}
