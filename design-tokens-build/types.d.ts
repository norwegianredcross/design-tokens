/* build: v1.7.1 */
import type {} from '@digdir/designsystemet/types';

// Augment types based on theme
declare module '@digdir/designsystemet/types' {
  export interface ColorDefinitions {
    'primary-color-red': never;
    'secondary-color-orange': never;
    'secondary-color-rust': never;
    'secondary-color-pink': never;
    'additional-color-ocean': never;
    'additional-color-jungle': never;
    neutral: never;
  }
  export interface SeverityColorDefinitions {
    info: never;
    success: never;
    warning: never;
    danger: never;
  }
}
