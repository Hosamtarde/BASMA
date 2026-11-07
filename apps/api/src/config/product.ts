/** Re-exported so API code keeps one import path; the name itself lives in packages/shared (SPEC §2.3). */
export { PRODUCT_NAME } from '@app/shared';

/** Stable machine id of the product, written into every database (schema_meta) to validate restores. */
export const PRODUCT_ID = 'dental-lab-system';
