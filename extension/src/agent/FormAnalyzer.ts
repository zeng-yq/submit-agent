/**
 * FormAnalyzer — barrel re-export.
 * All implementation lives in ./form-analyzer/
 */
export {
  analyzeForms,
  resolveField,
  classifyForm,
  inferFieldPurpose,
  inferEffectiveType,
  classifyFields,
  detectCommentLinks,
  buildFieldList,
} from './form-analyzer'

export type {
  FormField,
  PageInfo,
  FormAnalysisResult,
  CommentLinkResult,
  FormRole,
  FormConfidence,
  FormGroup,
} from './form-analyzer'
