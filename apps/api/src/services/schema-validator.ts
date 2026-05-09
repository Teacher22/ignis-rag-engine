import { NamespaceSchemaConfig } from '@ignis/shared';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateDocumentSchema(
  filename: string,
  mimeType: string,
  fileSizeBytes: number,
  schemaConfig: NamespaceSchemaConfig | null | undefined
): ValidationResult {
  if (!schemaConfig) return { valid: true, errors: [] };

  const errors: string[] = [];
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  // Check allowed types
  if (schemaConfig.allowed_types?.length) {
    if (!schemaConfig.allowed_types.includes(ext)) {
      errors.push(
        `File type '${ext}' is not allowed. Allowed: ${schemaConfig.allowed_types.join(', ')}`
      );
    }
  }

  // Check max file size
  if (schemaConfig.max_file_size_mb) {
    const sizeMB = fileSizeBytes / (1024 * 1024);
    if (sizeMB > schemaConfig.max_file_size_mb) {
      errors.push(
        `File size ${sizeMB.toFixed(1)}MB exceeds limit of ${schemaConfig.max_file_size_mb}MB`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
