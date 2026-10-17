import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '../../services/api/client';

/** Maps server validation issues onto form fields; returns a message for anything left over. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly string[]): string | null {
  if (err instanceof ApiError) {
    let mapped = false;
    for (const issue of err.fieldIssues) {
      if (fields.includes(issue.path)) {
        setError(issue.path as Path<T>, { message: issue.message });
        mapped = true;
      }
    }
    return mapped && err.code === 'VALIDATION_ERROR' ? null : err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
