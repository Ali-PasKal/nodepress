import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api-client';

/**
 * Maps a 422 response's per-field issues onto form fields. Returns the message to show for errors that
 * are not tied to a field (or null if everything was attached to fields).
 */
export function applyServerErrors<Values extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<Values>,
  fields: readonly Path<Values>[],
): string | null {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Please try again.';
  }
  let unattached = false;
  for (const issue of error.issues) {
    const field = fields.find((candidate) => candidate === issue.path);
    if (field) {
      setError(field, { type: 'server', message: issue.message });
    } else {
      unattached = true;
    }
  }
  if (error.issues.length > 0 && !unattached) {
    return null;
  }
  return error.message;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}
