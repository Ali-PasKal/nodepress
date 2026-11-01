import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

export interface StoredVariant {
  readonly width: number;
  readonly height: number;
  readonly key: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/** Public URLs of stored files: MEDIA_PUBLIC_BASE_URL (CDN/bucket) when set, else /uploads on this host. */
@Injectable()
export class MediaUrls {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  url(key: string): string {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${this.config.media.publicBaseUrl ?? '/uploads'}/${encoded}`;
  }

  /** Smallest variant at least `minWidth` wide, falling back to the largest variant or the original. */
  bestUrl(originalKey: string, variants: readonly StoredVariant[], minWidth: number): string {
    const sorted = [...variants].sort((a, b) => a.width - b.width);
    const fit = sorted.find((variant) => variant.width >= minWidth) ?? sorted.at(-1);
    return this.url(fit?.key ?? originalKey);
  }
}
