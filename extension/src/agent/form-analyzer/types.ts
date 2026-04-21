/** Form field metadata extracted from a page form */
export interface FormField {
  canonical_id: string;
  name: string;
  id: string;
  type: string;
  label: string;
  placeholder: string;
  required: boolean;
  maxlength: number | null;
  inferred_purpose?: string;
  effective_type?: string;
  selector: string;
  tagName: string;
  form_index?: number;
}

export interface PageInfo {
  title: string;
  description: string;
  headings: string[];
  content_preview: string;
}

export interface FormAnalysisResult {
  fields: FormField[];
  forms: FormGroup[];
  page_info: PageInfo;
  commentLinks?: CommentLinkResult;
}

export interface CommentLinkResult {
  hasExternalLinks: boolean;
  uniqueDomains: number;
  totalLinks: number;
}

export type FormRole = 'search' | 'login' | 'newsletter' | 'unknown'
export type FormConfidence = 'high' | 'medium' | 'low'

export interface FormGroup {
  form_index: number
  role: FormRole
  confidence: FormConfidence
  form_id?: string
  form_action?: string
  field_count: number
  filtered: boolean
}
