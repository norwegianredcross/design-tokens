/* This file is deprecated and will be removed in a future release. Use types.d.ts instead */
/* build: v1.18.0 */
import type {} from '@digdir/designsystemet-types';

// Augment types based on theme
declare module '@digdir/designsystemet-types' {
  export interface ColorDefinitions {
    'hoved-beige': never;
    neutral: never;
    'hoved-rosa': never;
    'hoved-mint': never;
    'hoved-lysebla': never;
    'hoved-neutral': never;
    'red-cta': never;
    'secondary-color-orange': never;
    'rust-main': never;
    'secondary-color-pink': never;
    'additional-color-ocean': never;
    'additional-color-jungle': never;
    'secondary-color-warm-beige': never;
    'primary-color-red': never;
    'secondary-color-rust': never;
  }
  export interface SeverityColorDefinitions {
    info: never;
    success: never;
    warning: never;
    danger: never;
  }
}
