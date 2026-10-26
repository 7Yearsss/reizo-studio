import { useEffect } from 'react';
import { diskLevel, formatBytes, nextDiskCheckMs, shouldWarnDisk, type DiskLevel } from '../../../shared/diskSpace';
import * as api from '../../api';
import { toast } from '../../lib/toast';

/** Watches free space on the data drive and warns once per worsening level. Renders nothing. */
export default function DiskSpaceMonitor(): null {
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let warned: DiskLevel = 'ok';

    async function check() {
      let wait = 60 * 60_000;
      try {
        const { freeBytes } = await api.getDiskSpace();
        if (!cancelled && freeBytes !== null) {
          const level = diskLevel(freeBytes);
          if (shouldWarnDisk(warned, level)) {
            const text = `数据所在磁盘仅剩 ${formatBytes(freeBytes)}，画布视频等素材可能写入失败。可在设置里清理存储。`;
            if (level === 'critical') toast.error('磁盘空间严重不足', text);
            else toast.info('磁盘空间不足', text);
          }
          warned = level;
          wait = nextDiskCheckMs(freeBytes);
        }
      } catch { /* a failed probe is not worth a message */ }
      if (!cancelled) timer = window.setTimeout((): void => void check(), wait);
    }

    timer = window.setTimeout((): void => void check(), 10_000);
    return (): void => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, []);
  return null;
}
