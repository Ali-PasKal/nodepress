import type { MediaDetail } from '@nexora/shared';
import { useState } from 'react';
import { errorMessage } from '../../lib/forms';
import { formatBytes, uploadMedia, useInvalidateMedia, useMediaLimits } from './api';

export interface UploadItem {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
  readonly status: 'uploading' | 'done' | 'error';
  readonly error?: string;
  readonly media?: MediaDetail;
}

let counter = 0;

/** Uploads files one by one with progress; checks the size limit before sending anything. */
export function useUploadQueue(onUploaded?: (media: MediaDetail) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const limits = useMediaLimits(true);
  const invalidate = useInvalidateMedia();

  const update = (id: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const add = async (files: Iterable<File>) => {
    for (const file of files) {
      counter += 1;
      const id = `upload-${String(counter)}`;
      const max = limits.data?.maxUploadBytes;
      if (max !== undefined && file.size > max) {
        setItems((current) => [
          ...current,
          {
            id,
            name: file.name,
            progress: 0,
            status: 'error',
            error: `Larger than ${formatBytes(max)}.`,
          },
        ]);
        continue;
      }
      setItems((current) => [
        ...current,
        { id, name: file.name, progress: 0, status: 'uploading' },
      ]);
      try {
        const media = await uploadMedia(file, (progress) => {
          update(id, { progress });
        });
        update(id, { progress: 1, status: 'done', media });
        invalidate();
        onUploaded?.(media);
      } catch (error) {
        update(id, { status: 'error', error: errorMessage(error) });
      }
    }
  };

  const clearFinished = () => {
    setItems((current) => current.filter((item) => item.status === 'uploading'));
  };

  return { items, add, clearFinished, accept: limits.data?.acceptedTypes.join(',') };
}
