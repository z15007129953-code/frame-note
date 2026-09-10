export type StorageErrorCode = 'invalid-image' | 'invalid-key' | 'not-found' | 'storage-failed';

const messages: Record<StorageErrorCode, string> = {
  'invalid-image': 'Invalid image.',
  'invalid-key': 'Invalid image key.',
  'not-found': 'Image not found.',
  'storage-failed': 'Image storage failed.',
};

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode) {
    super(messages[code]);
    this.name = 'StorageError';
    this.code = code;
  }
}
