import type { JSONContent } from '@tiptap/core';
import { Schema, type MarkSpec, type NodeSpec } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { addSuggestionMarks, transformToSuggestionTransaction } from '@handlewithcare/prosemirror-suggest-changes';
import { documentSchema, editTransaction, type DocumentContent, type DocumentEdit } from './documentContent';

const reviewNodes: Record<string, NodeSpec> = {};
const reviewMarks: Record<string, MarkSpec> = {};
documentSchema.spec.nodes.forEach((name, spec) => { reviewNodes[name] = { ...spec, ...(!spec.inline && name !== 'text' ? { marks: '_' } : {}) }; });
documentSchema.spec.marks.forEach((name, spec) => { reviewMarks[name] = spec; });
export const documentReviewSchema = new Schema({ nodes: reviewNodes, marks: addSuggestionMarks(reviewMarks) });

/** Review data is a projection only. Commits always apply validated edits to the clean document. */
export function reviewDocumentEdit(content: DocumentContent, edit: DocumentEdit, changeId: string): JSONContent {
  const state = EditorState.create({ schema: documentReviewSchema, doc: documentReviewSchema.nodeFromJSON(content.doc) });
  const transaction = editTransaction(state, edit);
  return transformToSuggestionTransaction(transaction, state, () => changeId).doc.toJSON();
}

