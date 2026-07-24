/**
 * dom-utils — barrel re-export during SP-3b migration.
 * 实现已拆到 dom-writers.ts（L5）+ field-filter.ts（L4）。
 * 本 barrel 仅为迁移过渡，Task 2 会更新 caller/test 直接 import 后删除本文件。
 */
export * from './dom-writers'
export * from './field-filter'
